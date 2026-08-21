const mongoose = require("mongoose");
const Payment = require("../model/payment");
const Payroll = require("../model/payroll");
const PayrollRun = require("../model/payrollRun");
const Employee = require("../model/employee");
const EmployeeAdvance = require("../model/employeeAdvance");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    toMajor,
    formatMoney,
    assertNotOverpaying,
} = require("../utils/money");
const {
    generatePaymentNumber,
    resolveAmountMinor,
    assertMethodProviderCombo,
    applyStatusTransition,
    assertNotPaidLocked,
    auditPayment,
} = require("./paymentFoundationService");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");
const {
    markLinePaid,
    unmarkLinePaid,
    tryMarkRunPaid,
    tryUnlockRunAfterReverse,
} = require("./payrollRunService");
const {
    disburseAdvance,
    reverseAdvance,
} = require("./employeeAdvanceService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const EMPLOYEE_PAYMENT_TYPES = new Set([
    "EmployeeSalary",
    "EmployeeAdvance",
    "EmployeeBonus",
    "EmployeeOther",
]);

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const { isCompanyOwner } = require("../utils/roleAccess");
const isOwner = (user) => isCompanyOwner(user?.role);

const mapLegacyMethod = (raw) => {
    const s = String(raw || "")
        .trim()
        .toLowerCase();
    if (!s) return "BANK_TRANSFER";
    if (s.includes("cash")) return "CASH";
    if (s.includes("cheque") || s.includes("check")) return "CHECK";
    if (s.includes("ach")) return "ACH";
    if (s.includes("apple")) return "APPLE_PAY";
    if (s.includes("card") || s.includes("visa") || s.includes("master")) {
        return "CARD";
    }
    if (s.includes("bank") || s.includes("transfer") || s.includes("wire")) {
        return "BANK_TRANSFER";
    }
    return String(raw).trim().toUpperCase().replace(/\s+/g, "_");
};

const populatePayment = (q) =>
    q
        .populate("partyId")
        .populate(
            "payrollId",
            "payrollNumber employeeName employeeCode netSalaryMinor status payrollMonth payrollYear"
        )
        .populate("payrollRunId", "runNumber status payrollMonth payrollYear")
        .populate(
            "employeeAdvanceId",
            "advanceNumber employeeName status approvedAmountMinor outstandingMinor"
        )
        .populate("createdBy", "firstName lastName email role")
        .populate("approvedBy", "firstName lastName email role")
        .populate("postedBy", "firstName lastName email role");

const serializePayment = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    const currency = plain.currency || DEFAULT_CURRENCY;
    return {
        ...plain,
        amounts: {
            amount: toMajor(plain.amountMinor || 0, currency),
            paidAmount: toMajor(plain.paidAmountMinor || 0, currency),
            dueAmount: toMajor(plain.dueAmountMinor || 0, currency),
        },
    };
};

const getPaymentOrFail = async (id, companyId, session = null) => {
    let q = Payment.findOne({ _id: id, ...NOT_DELETED });
    if (session) q = q.session(session);
    const payment = await q;
    if (!payment) throw new AppError("Payment not found.", 404);
    assertDocumentCompany(payment, companyId, "Payment");
    if (!EMPLOYEE_PAYMENT_TYPES.has(payment.paymentType)) {
        throw new AppError("Not an employee payment.", 400);
    }
    return payment;
};

const findLinkedEmployee = async (user) => {
    if (!user?._id) return null;
    return Employee.findOne({
        userId: user._id,
        ...NOT_DELETED,
    })
        .select("_id")
        .lean();
};

const assertCanViewPayment = async (payment, user) => {
    if (isOwner(user)) return;
    if (String(payment.createdBy) === String(user._id)) return;
    const mine = await findLinkedEmployee(user);
    if (mine && String(payment.partyId) === String(mine._id)) return;
    throw new AppError("You can only view your own employee payments.", 403);
};

const loadPayrollLine = async (payrollId, companyId, session = null) => {
    let q = Payroll.findOne({
        _id: payrollId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) q = q.session(session);
    const line = await q;
    if (!line) throw new AppError("Payroll line not found.", 404);
    return line;
};

const loadAdvance = async (advanceId, companyId, session = null) => {
    let q = EmployeeAdvance.findOne({
        _id: advanceId,
        companyId,
        ...NOT_DELETED,
    });
    if (session) q = q.session(session);
    const doc = await q;
    if (!doc) throw new AppError("Employee advance not found.", 404);
    return doc;
};

/**
 * Create employee salary or advance payment.
 * Kind inferred from payrollId / employeeAdvanceId / paymentType.
 */
const createEmployeePayment = async (payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);

    const payrollId = toObjectId(payload.payrollId);
    const advanceId = toObjectId(
        payload.employeeAdvanceId || payload.advanceId
    );

    let paymentType = String(payload.paymentType || "").trim();
    if (!paymentType) {
        if (payrollId) paymentType = "EmployeeSalary";
        else if (advanceId) paymentType = "EmployeeAdvance";
        else {
            throw new AppError(
                "payrollId or employeeAdvanceId is required.",
                400
            );
        }
    }
    if (!EMPLOYEE_PAYMENT_TYPES.has(paymentType)) {
        throw new AppError(
            `Invalid paymentType. Allowed: ${[...EMPLOYEE_PAYMENT_TYPES].join(", ")}`,
            400
        );
    }

    const purpose =
        paymentType === "EmployeeSalary"
            ? "salary"
            : paymentType === "EmployeeAdvance"
              ? "advance"
              : payload.purpose === "bonus"
                ? "bonus"
                : "other";

    const { amountMinor, currency, amount } = resolveAmountMinor(
        payload,
        payload.currency || DEFAULT_CURRENCY
    );

    const methodRaw = mapLegacyMethod(
        payload.paymentMethod || payload.method || "BANK_TRANSFER"
    );
    let provider = payload.paymentProvider || "NONE";
    if (
        (methodRaw === "CARD" || methodRaw === "APPLE_PAY") &&
        (!provider || provider === "NONE")
    ) {
        provider = "STRIPE";
    }
    const { paymentMethod, paymentProvider } = assertMethodProviderCombo(
        methodRaw,
        provider
    );

    let partyId = null;
    let branchId = null;
    let payrollRunId = null;
    let allocations = [];

    if (paymentType === "EmployeeSalary") {
        if (!payrollId) throw new AppError("payrollId is required.", 400);
        const line = await loadPayrollLine(payrollId, companyId);

        if (!isOwner(user)) {
            const mine = await findLinkedEmployee(user);
            if (!mine || String(line.employeeId) !== String(mine._id)) {
                throw new AppError(
                    "You can only request salary payment for yourself.",
                    403
                );
            }
        }

        const run = await PayrollRun.findOne({
            _id: line.payrollRunId,
            companyId,
            ...NOT_DELETED,
        });
        if (!run) throw new AppError("Payroll run not found.", 404);
        if (!["locked", "paid"].includes(run.status)) {
            throw new AppError(
                `Payroll run must be locked before creating salary payments (status=${run.status}).`,
                400
            );
        }
        if (!["approved", "calculated"].includes(line.status)) {
            throw new AppError(
                `Payroll line must be approved before payment (status=${line.status}).`,
                400
            );
        }
        if (line.status === "paid" || line.paymentStatus === "Completed") {
            throw new AppError("This payroll line is already paid.", 400);
        }

        // V1: full net only (no partial salary overpay / underpay stretch)
        const due = Number(line.netSalaryMinor) || 0;
        if (due <= 0) {
            throw new AppError("Payroll net salary is zero — nothing to pay.", 400);
        }
        assertNotOverpaying(amountMinor, due, "Salary payment");
        if (amountMinor !== due) {
            throw new AppError(
                `Salary payment must equal net salary ${formatMoney(due)} (got ${formatMoney(amountMinor)}).`,
                400
            );
        }

        // Block duplicate open payments for same line
        const open = await Payment.findOne({
            companyId,
            payrollId: line._id,
            paymentType: "EmployeeSalary",
            ...NOT_DELETED,
            status: {
                $in: ["draft", "pendingApproval", "approved", "processing", "paid"],
            },
            originalPaymentId: null,
        }).select("paymentNumber status");
        if (open) {
            throw new AppError(
                `Payment ${open.paymentNumber} already exists for this payroll line (${open.status}).`,
                409
            );
        }

        partyId = line.employeeId;
        branchId = line.branchId || run.branchId || null;
        payrollRunId = line.payrollRunId;
        allocations = [
            {
                targetType: "Payroll",
                targetId: line._id,
                amountMinor,
                note: "salary",
            },
        ];
    } else if (paymentType === "EmployeeAdvance") {
        if (!advanceId) {
            throw new AppError("employeeAdvanceId is required.", 400);
        }
        const adv = await loadAdvance(advanceId, companyId);

        if (!isOwner(user)) {
            const mine = await findLinkedEmployee(user);
            if (
                !mine ||
                (String(adv.employeeId) !== String(mine._id) &&
                    String(adv.createdBy) !== String(user._id))
            ) {
                throw new AppError(
                    "You can only request advance disbursement for yourself.",
                    403
                );
            }
        }

        if (adv.status !== "approved") {
            throw new AppError(
                `Advance must be approved before disbursement (status=${adv.status}).`,
                400
            );
        }
        const approved = Number(adv.approvedAmountMinor) || 0;
        if (approved <= 0) {
            throw new AppError("Advance has no approved amount.", 400);
        }
        assertNotOverpaying(amountMinor, approved, "Advance disbursement");
        if (amountMinor !== approved) {
            throw new AppError(
                `Advance disbursement must equal approved ${formatMoney(approved)}.`,
                400
            );
        }

        const open = await Payment.findOne({
            companyId,
            employeeAdvanceId: adv._id,
            paymentType: "EmployeeAdvance",
            ...NOT_DELETED,
            status: {
                $in: ["draft", "pendingApproval", "approved", "processing", "paid"],
            },
            originalPaymentId: null,
        }).select("paymentNumber status");
        if (open) {
            throw new AppError(
                `Payment ${open.paymentNumber} already exists for this advance (${open.status}).`,
                409
            );
        }

        partyId = adv.employeeId;
        branchId = adv.branchId || null;
        allocations = [
            {
                targetType: "EmployeeAdvance",
                targetId: adv._id,
                amountMinor,
                note: "advance",
            },
        ];
    } else {
        // Bonus / other — require employeeId
        partyId = toObjectId(payload.employeeId || payload.partyId);
        if (!partyId) throw new AppError("employeeId is required.", 400);
        const emp = await Employee.findOne({
            _id: partyId,
            ...NOT_DELETED,
        }).select("branchId");
        if (!emp) throw new AppError("Employee not found.", 404);
        branchId = emp.branchId || null;
        allocations = [
            {
                targetType: "Other",
                targetId: partyId,
                amountMinor,
                note: paymentType,
            },
        ];
    }

    const paymentNumber = await generatePaymentNumber();
    const owner = isOwner(user);
    const forcePending = payload.forcePending === true;
    const initialStatus =
        owner && !forcePending ? "approved" : "pendingApproval";

    const payment = await Payment.create({
        companyId,
        branchId,
        paymentNumber,
        paymentDate: payload.paymentDate
            ? new Date(payload.paymentDate)
            : new Date(),
        paymentType,
        purpose,
        partyType: "Employee",
        partyId,
        payrollId: payrollId || null,
        payrollRunId: payrollRunId || null,
        employeeAdvanceId: advanceId || null,
        currency,
        amountMinor,
        amount,
        paidAmountMinor: 0,
        paidAmount: 0,
        dueAmountMinor: amountMinor,
        dueAmount: amount,
        paymentMethod,
        paymentProvider,
        providerTransactionId: String(
            payload.providerTransactionId || ""
        ).trim(),
        providerPaymentIntentId: String(
            payload.providerPaymentIntentId || ""
        ).trim(),
        paymentMethodReference: String(
            payload.paymentMethodReference || ""
        ).trim(),
        transactionReference: String(
            payload.transactionReference ||
                payload.paymentRef ||
                payload.reference ||
                ""
        ).trim(),
        bankName: String(payload.bankName || "").trim(),
        accountReference: String(payload.accountReference || "").trim(),
        checkNumber: String(
            payload.checkNumber || payload.chequeNumber || ""
        ).trim(),
        checkDate: payload.checkDate ? new Date(payload.checkDate) : null,
        status: initialStatus,
        requiresApproval: initialStatus === "pendingApproval",
        requestedBy: user._id,
        createdBy: user._id,
        note: String(payload.note || "").trim().slice(0, 1000),
        sourceModule: "HR",
        isManualEntry: true,
        allocations,
    });

    if (owner && !forcePending) {
        payment.approvedBy = user._id;
        payment.approvedAt = new Date();
        await payment.save();
    }

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Create",
        description: `Employee payment ${payment.paymentNumber} created (${paymentType}, ${formatMoney(amountMinor)})`,
        payment,
        ipAddress: meta.ipAddress || "",
    });

    if (owner && payload.completeImmediately === true) {
        return completeEmployeePayment(payment._id, user, {
            ...meta,
            allowSelfApprove: true,
        });
    }

    const populated = await populatePayment(Payment.findById(payment._id));
    return serializePayment(populated);
};

const approveEmployeePayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can approve employee payments.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(id, companyId);

    if (
        payment.createdBy &&
        String(payment.createdBy) === String(user._id) &&
        payment.requiresApproval &&
        !meta.allowSelfApprove
    ) {
        throw new AppError(
            "You cannot approve your own payment request. Another owner must approve.",
            403
        );
    }

    if (payment.status !== "pendingApproval" && payment.status !== "draft") {
        throw new AppError(
            `Cannot approve payment in status "${payment.status}".`,
            400
        );
    }

    const old = { status: payment.status };
    applyStatusTransition(payment, "approved", user._id, {
        note: meta.note || "",
    });
    await payment.save();

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Approve",
        description: `Employee payment ${payment.paymentNumber} approved`,
        payment,
        oldData: old,
        reason: meta.note || "",
        ipAddress: meta.ipAddress || "",
    });

    return serializePayment(
        await populatePayment(Payment.findById(payment._id))
    );
};

const completeEmployeePayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError(
            "Only the owner can complete employee payments.",
            403
        );
    }
    const companyId = await ensureUserCompany(user);
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payment = await getPaymentOrFail(id, companyId, session);

        if (payment.status === "paid") {
            throw new AppError("Payment is already completed.", 400);
        }
        if (payment.status === "pendingApproval" || payment.status === "draft") {
            applyStatusTransition(payment, "approved", user._id, {
                note: meta.note || "Auto-approved on complete",
            });
        }
        if (payment.status !== "approved" && payment.status !== "processing") {
            throw new AppError(
                `Cannot complete payment in status "${payment.status}".`,
                400
            );
        }

        if (
            (payment.paymentMethod === "CARD" ||
                payment.paymentMethod === "APPLE_PAY") &&
            payment.paymentProvider === "STRIPE"
        ) {
            const { getPaymentProvider } = require("./paymentProviders");
            const intentId =
                payment.providerPaymentIntentId ||
                meta.providerPaymentIntentId ||
                meta.providerTransactionId;
            if (!intentId) {
                throw new AppError(
                    "Stripe PaymentIntent id is required to complete CARD / APPLE_PAY payments.",
                    400
                );
            }
            const status = await getPaymentProvider("STRIPE").getPaymentStatus(
                String(intentId)
            );
            if (!status.succeeded) {
                throw new AppError(
                    `Stripe payment not succeeded (status=${status.status}).`,
                    400
                );
            }
            if (
                status.amountReceivedMinor != null &&
                Number(status.amountReceivedMinor) !== Number(payment.amountMinor)
            ) {
                throw new AppError("Stripe amount does not match payment.", 400);
            }
            payment.providerPaymentIntentId =
                status.providerPaymentIntentId ||
                payment.providerPaymentIntentId;
            payment.providerTransactionId =
                status.providerTransactionId || String(intentId);
        } else if (
            (payment.paymentMethod === "CARD" ||
                payment.paymentMethod === "APPLE_PAY") &&
            !payment.providerTransactionId &&
            !meta.providerTransactionId
        ) {
            throw new AppError(
                "providerTransactionId is required to complete CARD / APPLE_PAY payments.",
                400
            );
        } else if (meta.providerTransactionId) {
            payment.providerTransactionId = String(meta.providerTransactionId);
        }

        applyStatusTransition(payment, "processing", user._id);
        await payment.save({ session });

        if (payment.paymentType === "EmployeeSalary" && payment.payrollId) {
            await markLinePaid(payment.payrollId, {
                companyId,
                paymentId: payment._id,
                actorId: user._id,
                session,
            });
            const line = await loadPayrollLine(
                payment.payrollId,
                companyId,
                session
            );
            await tryMarkRunPaid(line.payrollRunId, {
                companyId,
                actorId: user._id,
                session,
            });
        } else if (
            payment.paymentType === "EmployeeAdvance" &&
            payment.employeeAdvanceId
        ) {
            // disburseAdvance uses its own save — call after commit-safe path
            // Re-validate advance still approved inside txn via session load
            const adv = await loadAdvance(
                payment.employeeAdvanceId,
                companyId,
                session
            );
            if (adv.status !== "approved") {
                throw new AppError(
                    `Advance is no longer approved (status=${adv.status}).`,
                    400
                );
            }
        }

        applyStatusTransition(payment, "paid", user._id);
        payment.paidAmountMinor = payment.amountMinor;
        payment.paidAmount = payment.amount;
        payment.dueAmountMinor = 0;
        payment.dueAmount = 0;
        payment.transactionDate = new Date();
        payment.postedBy = user._id;
        payment.postedAt = new Date();
        await payment.save({ session });

        await session.commitTransaction();

        // Advance disburse outside txn (own document lifecycle) after paid
        if (
            payment.paymentType === "EmployeeAdvance" &&
            payment.employeeAdvanceId
        ) {
            await disburseAdvance(
                payment.employeeAdvanceId,
                {
                    paymentId: payment._id,
                    disbursedAmountMinor: payment.amountMinor,
                },
                user,
                meta
            );
        }

        await auditPayment({
            user,
            companyId,
            branchId: payment.branchId,
            activityType: "Payment",
            description: `Employee payment ${payment.paymentNumber} completed (${formatMoney(payment.amountMinor)})`,
            payment,
            ipAddress: meta.ipAddress || "",
        });

        return serializePayment(
            await populatePayment(Payment.findById(payment._id))
        );
    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const cancelEmployeePayment = async (id, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(id, companyId);
    assertNotPaidLocked(payment);

    if (
        !["draft", "pendingApproval", "approved", "failed"].includes(
            payment.status
        )
    ) {
        throw new AppError(
            `Cannot cancel payment in status "${payment.status}".`,
            400
        );
    }

    if (!isOwner(user) && String(payment.createdBy) !== String(user._id)) {
        throw new AppError("You can only cancel your own payment requests.", 403);
    }

    const old = { status: payment.status };
    applyStatusTransition(payment, "cancelled", user._id, {
        reason: meta.reason || "Cancelled",
    });
    await payment.save();

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Cancel",
        description: `Employee payment ${payment.paymentNumber} cancelled`,
        payment,
        oldData: old,
        reason: meta.reason || "",
        ipAddress: meta.ipAddress || "",
    });

    return serializePayment(
        await populatePayment(Payment.findById(payment._id))
    );
};

const reverseEmployeePayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError(
            "Only the owner can reverse employee payments.",
            403
        );
    }
    const reason = String(meta.reason || "").trim();
    if (!reason) throw new AppError("Reversal reason is required.", 400);

    const companyId = await ensureUserCompany(user);
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const original = await getPaymentOrFail(id, companyId, session);
        if (original.status !== "paid") {
            throw new AppError("Only paid payments can be reversed.", 400);
        }
        if (original.reversalPaymentId) {
            throw new AppError("Payment was already reversed.", 400);
        }

        if (original.paymentType === "EmployeeSalary" && original.payrollId) {
            const line = await loadPayrollLine(
                original.payrollId,
                companyId,
                session
            );
            await unmarkLinePaid(original.payrollId, {
                companyId,
                actorId: user._id,
                session,
            });
            await tryUnlockRunAfterReverse(line.payrollRunId, {
                companyId,
                actorId: user._id,
                session,
            });
        }

        const reversalNumber = await generatePaymentNumber({ session });
        const [reversal] = await Payment.create(
            [
                {
                    companyId,
                    branchId: original.branchId,
                    paymentNumber: reversalNumber,
                    paymentDate: new Date(),
                    paymentType: original.paymentType,
                    purpose: original.purpose,
                    partyType: "Employee",
                    partyId: original.partyId,
                    payrollId: original.payrollId,
                    payrollRunId: original.payrollRunId,
                    employeeAdvanceId: original.employeeAdvanceId,
                    currency: original.currency,
                    amountMinor: original.amountMinor,
                    amount: original.amount,
                    paidAmountMinor: original.amountMinor,
                    paidAmount: original.amount,
                    dueAmountMinor: 0,
                    dueAmount: 0,
                    paymentMethod: original.paymentMethod,
                    paymentProvider: original.paymentProvider,
                    status: "reversed",
                    originalPaymentId: original._id,
                    reversedBy: user._id,
                    reversedAt: new Date(),
                    reversalReason: reason,
                    createdBy: user._id,
                    postedBy: user._id,
                    postedAt: new Date(),
                    note: `Reversal of ${original.paymentNumber}: ${reason}`,
                    sourceModule: "HR",
                    requiresApproval: false,
                    allocations: original.allocations || [],
                },
            ],
            { session }
        );

        applyStatusTransition(original, "reversed", user._id, { reason });
        original.reversalPaymentId = reversal._id;
        original.reversalReason = reason;
        original.reversedBy = user._id;
        original.reversedAt = new Date();
        await original.save({ session });

        await session.commitTransaction();

        if (
            original.paymentType === "EmployeeAdvance" &&
            original.employeeAdvanceId
        ) {
            const adv = await EmployeeAdvance.findOne({
                _id: original.employeeAdvanceId,
                companyId,
                ...NOT_DELETED,
            });
            if (
                adv &&
                ["disbursed", "recovering"].includes(adv.status)
            ) {
                await reverseAdvance(
                    adv._id,
                    { reason: `Payment ${original.paymentNumber} reversed: ${reason}` },
                    user,
                    meta
                );
            }
        }

        await auditPayment({
            user,
            companyId,
            branchId: original.branchId,
            activityType: "Update",
            description: `Employee payment ${original.paymentNumber} reversed`,
            payment: original,
            reason,
            ipAddress: meta.ipAddress || "",
        });

        return {
            original: serializePayment(
                await populatePayment(Payment.findById(original._id))
            ),
            reversal: serializePayment(
                await populatePayment(Payment.findById(reversal._id))
            ),
        };
    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const listEmployeePayments = async (companyId, query = {}, user) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const filter = {
        companyId,
        ...NOT_DELETED,
        paymentType: { $in: [...EMPLOYEE_PAYMENT_TYPES] },
        originalPaymentId: null,
    };

    if (query.status) filter.status = query.status;
    if (query.paymentType && EMPLOYEE_PAYMENT_TYPES.has(query.paymentType)) {
        filter.paymentType = query.paymentType;
    }
    if (query.purpose) filter.purpose = query.purpose;
    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.partyId = toObjectId(query.employeeId);
    }
    if (query.payrollId && toObjectId(query.payrollId)) {
        filter.payrollId = toObjectId(query.payrollId);
    }
    if (query.payrollRunId && toObjectId(query.payrollRunId)) {
        filter.payrollRunId = toObjectId(query.payrollRunId);
    }
    if (query.employeeAdvanceId && toObjectId(query.employeeAdvanceId)) {
        filter.employeeAdvanceId = toObjectId(query.employeeAdvanceId);
    }

    if (!isOwner(user)) {
        const mine = await findLinkedEmployee(user);
        const or = [{ createdBy: user._id }];
        if (mine) or.push({ partyId: mine._id });
        filter.$or = or;
    }

    const [items, total] = await Promise.all([
        populatePayment(
            Payment.find(filter)
                .sort({ paymentDate: -1, createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
        ),
        Payment.countDocuments(filter),
    ]);

    return {
        items: items.map(serializePayment),
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    };
};

const getEmployeePaymentById = async (id, companyId, user) => {
    const payment = await populatePayment(
        Payment.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!payment) throw new AppError("Payment not found.", 404);
    assertDocumentCompany(payment, companyId, "Payment");
    if (!EMPLOYEE_PAYMENT_TYPES.has(payment.paymentType)) {
        throw new AppError("Not an employee payment.", 400);
    }
    await assertCanViewPayment(payment, user);
    return serializePayment(payment);
};

const getEmployeePaymentReceipt = async (id, companyId, user) => {
    const payment = await getEmployeePaymentById(id, companyId, user);
    return {
        receiptType: "employee_payment",
        generatedAt: new Date().toISOString(),
        payment,
        summary: {
            paymentNumber: payment.paymentNumber,
            paymentType: payment.paymentType,
            purpose: payment.purpose,
            status: payment.status,
            amount: formatMoney(payment.amountMinor || 0, payment.currency),
            method: payment.paymentMethod,
            provider: payment.paymentProvider,
            employee:
                payment.partyId?.fullName ||
                payment.payrollId?.employeeName ||
                payment.employeeAdvanceId?.employeeName ||
                "",
        },
    };
};

module.exports = {
    mapLegacyMethod,
    createEmployeePayment,
    approveEmployeePayment,
    completeEmployeePayment,
    cancelEmployeePayment,
    reverseEmployeePayment,
    listEmployeePayments,
    getEmployeePaymentById,
    getEmployeePaymentReceipt,
    serializePayment,
};
