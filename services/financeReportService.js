const Payment = require("../model/payment");
const SupplierPayable = require("../model/supplierPayable");
const PayrollRun = require("../model/payrollRun");
const Payroll = require("../model/payroll");
const EmployeeAdvance = require("../model/employeeAdvance");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    toMajor,
    formatMoney,
} = require("../utils/money");
const { getCompanyById } = require("./companyService");
const {
    getSupplierPaymentReceipt,
} = require("./supplierPaymentService");
const {
    getEmployeePaymentReceipt,
} = require("./employeePaymentService");
const { getLineById, getRunById } = require("./payrollRunService");
const {
    refreshPayablesCommercialFromPos,
} = require("./supplierPayableService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    const mongoose = require("mongoose");
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const companySnapshot = async (companyId) => {
    try {
        const c = await getCompanyById(companyId);
        if (!c) return { currency: DEFAULT_CURRENCY };
        const plain = c.toObject ? c.toObject() : c;
        return {
            _id: plain._id,
            companyCode: plain.companyCode || "",
            legalName: plain.legalName || "",
            tradeName: plain.tradeName || "",
            currency: plain.defaultCurrency || DEFAULT_CURRENCY,
            countryCode: plain.countryCode || "US",
            timezone: plain.timezone || "",
            address: plain.address || {},
            phone: plain.phone || "",
            email: plain.email || "",
        };
    } catch (_) {
        return { currency: DEFAULT_CURRENCY };
    }
};

const sumMinor = (rows, key) =>
    rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const periodBounds = (query = {}) => {
    const year = query.year ? parseInt(query.year, 10) : null;
    const month = query.month ? parseInt(query.month, 10) : null;
    let from = query.from ? new Date(query.from) : null;
    let to = query.to ? new Date(query.to) : null;
    if (year && month && !from && !to) {
        from = new Date(Date.UTC(year, month - 1, 1));
        to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else if (year && !month && !from && !to) {
        from = new Date(Date.UTC(year, 0, 1));
        to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    }
    return { from, to, year, month };
};

/**
 * Finance dashboard rollup (Phase 8).
 */
const getDashboard = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const branchId = toObjectId(query.branchId);

    const payableFilter = {
        companyId,
        ...NOT_DELETED,
        status: { $ne: "cancelled" },
        $or: [
            { status: { $in: ["open", "partial"] } },
            { outstandingMinor: { $gt: 0 } },
            { remainingExposureMinor: { $gt: 0 } },
        ],
    };
    if (branchId) payableFilter.branchId = branchId;

    const advanceFilter = {
        companyId,
        ...NOT_DELETED,
        status: { $in: ["disbursed", "recovering"] },
    };
    if (branchId) advanceFilter.branchId = branchId;

    const runFilter = {
        companyId,
        ...NOT_DELETED,
        status: { $in: ["locked", "approved", "calculated", "pendingApproval"] },
    };
    if (branchId) runFilter.branchId = branchId;

    const [
        payables,
        advances,
        openRuns,
        paidSupplierMinor,
        paidEmployeeMinor,
    ] = await Promise.all([
        SupplierPayable.find(payableFilter),
        EmployeeAdvance.find(advanceFilter)
            .select("outstandingMinor currency status")
            .lean(),
        PayrollRun.find(runFilter)
            .select("status totalNetMinor payrollMonth payrollYear runNumber")
            .lean(),
        Payment.aggregate([
            {
                $match: {
                    companyId,
                    ...NOT_DELETED,
                    status: "paid",
                    paymentType: { $in: ["SupplierPayment", "SupplierAdvance"] },
                    originalPaymentId: null,
                    ...(branchId ? { branchId } : {}),
                },
            },
            { $group: { _id: null, total: { $sum: "$amountMinor" } } },
        ]),
        Payment.aggregate([
            {
                $match: {
                    companyId,
                    ...NOT_DELETED,
                    status: "paid",
                    paymentType: {
                        $in: [
                            "EmployeeSalary",
                            "EmployeeAdvance",
                            "EmployeeBonus",
                            "EmployeeOther",
                        ],
                    },
                    originalPaymentId: null,
                    ...(branchId ? { branchId } : {}),
                },
            },
            { $group: { _id: null, total: { $sum: "$amountMinor" } } },
        ]),
    ]);

    // Refresh GRN/PO commercial received value so due matches PO totals
    // (tax / discount / shipping), then recompute outstanding.
    await refreshPayablesCommercialFromPos(payables);

    const openPayables = payables.filter(
        (p) =>
            ["open", "partial"].includes(p.status) ||
            (Number(p.outstandingMinor) || 0) > 0
    );
    const payableOutstandingMinor = sumMinor(openPayables, "outstandingMinor");
    const payableExposureMinor = sumMinor(openPayables, "remainingExposureMinor");
    const advanceOutstandingMinor = sumMinor(advances, "outstandingMinor");
    const payrollNetPendingMinor = sumMinor(openRuns, "totalNetMinor");
    const supplierPaidMinor = paidSupplierMinor[0]?.total || 0;
    const employeePaidMinor = paidEmployeeMinor[0]?.total || 0;

    return {
        reportType: "finance_dashboard",
        generatedAt: new Date().toISOString(),
        company,
        currency: company.currency || DEFAULT_CURRENCY,
        cards: {
            supplierPayableOutstanding: {
                count: openPayables.filter(
                    (p) => (Number(p.outstandingMinor) || 0) > 0
                ).length,
                amountMinor: payableOutstandingMinor,
                amount: toMajor(payableOutstandingMinor),
                formatted: formatMoney(payableOutstandingMinor),
                remainingExposureMinor: payableExposureMinor,
                remainingExposure: toMajor(payableExposureMinor),
                remainingExposureFormatted: formatMoney(payableExposureMinor),
            },
            employeeAdvanceOutstanding: {
                count: advances.length,
                amountMinor: advanceOutstandingMinor,
                amount: toMajor(advanceOutstandingMinor),
                formatted: formatMoney(advanceOutstandingMinor),
            },
            payrollPendingNet: {
                count: openRuns.length,
                amountMinor: payrollNetPendingMinor,
                amount: toMajor(payrollNetPendingMinor),
                formatted: formatMoney(payrollNetPendingMinor),
            },
            supplierPaymentsPaid: {
                amountMinor: supplierPaidMinor,
                amount: toMajor(supplierPaidMinor),
                formatted: formatMoney(supplierPaidMinor),
            },
            employeePaymentsPaid: {
                amountMinor: employeePaidMinor,
                amount: toMajor(employeePaidMinor),
                formatted: formatMoney(employeePaidMinor),
            },
        },
    };
};

const getSupplierPayablesReport = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const filter = { companyId, ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    else filter.status = { $in: ["open", "partial", "settled"] };
    if (query.supplierId && toObjectId(query.supplierId)) {
        filter.supplierId = toObjectId(query.supplierId);
    }
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }

    const items = await SupplierPayable.find(filter)
        .populate("supplierId", "supplierCode name companyName")
        .populate("purchaseOrderId", "purchaseOrderNo status grandTotal")
        .sort({ updatedAt: -1 })
        .limit(Math.min(500, parseInt(query.limit, 10) || 200));

    await refreshPayablesCommercialFromPos(items);

    const outstandingMinor = sumMinor(
        items.filter((i) => ["open", "partial"].includes(i.status)),
        "outstandingMinor"
    );
    const remainingExposureMinor = sumMinor(
        items.filter((i) => ["open", "partial"].includes(i.status)),
        "remainingExposureMinor"
    );

    return {
        reportType: "supplier_payables",
        generatedAt: new Date().toISOString(),
        company,
        currency: DEFAULT_CURRENCY,
        filters: {
            status: query.status || "open,partial,settled",
            supplierId: query.supplierId || null,
            branchId: query.branchId || null,
        },
        totals: {
            count: items.length,
            outstandingMinor,
            outstanding: toMajor(outstandingMinor),
            outstandingFormatted: formatMoney(outstandingMinor),
            remainingExposureMinor,
            remainingExposure: toMajor(remainingExposureMinor),
            remainingExposureFormatted: formatMoney(remainingExposureMinor),
            payableDueMinor: sumMinor(items, "payableDueMinor"),
            paidAgainstPayableMinor: sumMinor(items, "paidAgainstPayableMinor"),
            advancePaidMinor: sumMinor(items, "advancePaidMinor"),
        },
        items: items.map((doc) => {
            const row = doc.toObject ? doc.toObject({ virtuals: true }) : doc;
            return {
                ...row,
                amounts: {
                    outstanding: toMajor(row.outstandingMinor || 0),
                    payableDue: toMajor(row.payableDueMinor || 0),
                    paidAgainst: toMajor(row.paidAgainstPayableMinor || 0),
                    advancePaid: toMajor(row.advancePaidMinor || 0),
                    remainingExposure: toMajor(row.remainingExposureMinor || 0),
                    grnReceivedValue: toMajor(row.grnReceivedValueMinor || 0),
                    poCommitment: toMajor(row.poCommitmentMinor || 0),
                },
            };
        }),
    };
};

const getSupplierPaymentsReport = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const { from, to } = periodBounds(query);
    const filter = {
        companyId,
        ...NOT_DELETED,
        paymentType: { $in: ["SupplierPayment", "SupplierAdvance"] },
        originalPaymentId: null,
    };
    if (query.status) filter.status = query.status;
    if (query.purpose) filter.purpose = query.purpose;
    if (query.supplierId && toObjectId(query.supplierId)) {
        filter.partyId = toObjectId(query.supplierId);
    }
    if (from || to) {
        filter.paymentDate = {};
        if (from) filter.paymentDate.$gte = from;
        if (to) filter.paymentDate.$lte = to;
    }

    const items = await Payment.find(filter)
        .sort({ paymentDate: -1 })
        .limit(Math.min(500, parseInt(query.limit, 10) || 200))
        .lean();

    const paid = items.filter((i) => i.status === "paid");
    const paidMinor = sumMinor(paid, "amountMinor");

    return {
        reportType: "supplier_payments",
        generatedAt: new Date().toISOString(),
        company,
        currency: DEFAULT_CURRENCY,
        filters: {
            status: query.status || null,
            purpose: query.purpose || null,
            from: from?.toISOString() || null,
            to: to?.toISOString() || null,
        },
        totals: {
            count: items.length,
            paidCount: paid.length,
            paidAmountMinor: paidMinor,
            paidAmount: toMajor(paidMinor),
            paidFormatted: formatMoney(paidMinor),
        },
        items: items.map((p) => ({
            ...p,
            amounts: {
                amount: toMajor(p.amountMinor || 0),
                formatted: formatMoney(p.amountMinor || 0),
            },
        })),
    };
};

const getPayrollRunsReport = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const filter = { companyId, ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    if (query.year) filter.payrollYear = parseInt(query.year, 10);
    if (query.month) filter.payrollMonth = parseInt(query.month, 10);
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }

    const items = await PayrollRun.find(filter)
        .sort({ payrollYear: -1, payrollMonth: -1 })
        .limit(Math.min(200, parseInt(query.limit, 10) || 100))
        .lean();

    const netMinor = sumMinor(items, "totalNetMinor");

    return {
        reportType: "payroll_runs",
        generatedAt: new Date().toISOString(),
        company,
        currency: DEFAULT_CURRENCY,
        filters: {
            status: query.status || null,
            year: query.year || null,
            month: query.month || null,
        },
        totals: {
            count: items.length,
            netMinor,
            net: toMajor(netMinor),
            netFormatted: formatMoney(netMinor),
            grossMinor: sumMinor(items, "totalGrossMinor"),
        },
        items: items.map((r) => ({
            ...r,
            amounts: {
                net: toMajor(r.totalNetMinor || 0),
                gross: toMajor(r.totalGrossMinor || 0),
                basic: toMajor(r.totalBasicMinor || 0),
            },
        })),
    };
};

const getPayrollRunSummary = async (runId, companyId) => {
    const run = await getRunById(runId, companyId, { includeLines: true });
    const company = await companySnapshot(companyId);
    return {
        reportType: "payroll_run_summary",
        generatedAt: new Date().toISOString(),
        company,
        currency: run.currency || DEFAULT_CURRENCY,
        run,
        printable: true,
    };
};

const getEmployeeAdvancesReport = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const filter = { companyId, ...NOT_DELETED };
    if (query.status) filter.status = query.status;
    else filter.status = { $in: ["approved", "disbursed", "recovering", "settled"] };
    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.employeeId = toObjectId(query.employeeId);
    }
    if (query.branchId && toObjectId(query.branchId)) {
        filter.branchId = toObjectId(query.branchId);
    }

    const items = await EmployeeAdvance.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(500, parseInt(query.limit, 10) || 200))
        .lean();

    const open = items.filter((i) =>
        ["disbursed", "recovering"].includes(i.status)
    );
    const outstandingMinor = sumMinor(open, "outstandingMinor");

    return {
        reportType: "employee_advances",
        generatedAt: new Date().toISOString(),
        company,
        currency: DEFAULT_CURRENCY,
        filters: {
            status: query.status || "approved,disbursed,recovering,settled",
            employeeId: query.employeeId || null,
        },
        totals: {
            count: items.length,
            openCount: open.length,
            outstandingMinor,
            outstanding: toMajor(outstandingMinor),
            outstandingFormatted: formatMoney(outstandingMinor),
            disbursedMinor: sumMinor(items, "disbursedAmountMinor"),
            recoveredMinor: sumMinor(items, "recoveredAmountMinor"),
        },
        items: items.map((a) => ({
            ...a,
            amounts: {
                requested: toMajor(a.requestedAmountMinor || 0),
                approved: toMajor(a.approvedAmountMinor || 0),
                disbursed: toMajor(a.disbursedAmountMinor || 0),
                recovered: toMajor(a.recoveredAmountMinor || 0),
                outstanding: toMajor(a.outstandingMinor || 0),
            },
        })),
    };
};

const getEmployeePaymentsReport = async (companyId, query = {}) => {
    const company = await companySnapshot(companyId);
    const { from, to } = periodBounds(query);
    const filter = {
        companyId,
        ...NOT_DELETED,
        paymentType: {
            $in: [
                "EmployeeSalary",
                "EmployeeAdvance",
                "EmployeeBonus",
                "EmployeeOther",
            ],
        },
        originalPaymentId: null,
    };
    if (query.status) filter.status = query.status;
    if (query.paymentType) filter.paymentType = query.paymentType;
    if (query.employeeId && toObjectId(query.employeeId)) {
        filter.partyId = toObjectId(query.employeeId);
    }
    if (from || to) {
        filter.paymentDate = {};
        if (from) filter.paymentDate.$gte = from;
        if (to) filter.paymentDate.$lte = to;
    }

    const items = await Payment.find(filter)
        .sort({ paymentDate: -1 })
        .limit(Math.min(500, parseInt(query.limit, 10) || 200))
        .lean();

    const paid = items.filter((i) => i.status === "paid");
    const paidMinor = sumMinor(paid, "amountMinor");

    return {
        reportType: "employee_payments",
        generatedAt: new Date().toISOString(),
        company,
        currency: DEFAULT_CURRENCY,
        filters: {
            status: query.status || null,
            paymentType: query.paymentType || null,
            from: from?.toISOString() || null,
            to: to?.toISOString() || null,
        },
        totals: {
            count: items.length,
            paidCount: paid.length,
            paidAmountMinor: paidMinor,
            paidAmount: toMajor(paidMinor),
            paidFormatted: formatMoney(paidMinor),
        },
        items: items.map((p) => ({
            ...p,
            amounts: {
                amount: toMajor(p.amountMinor || 0),
                formatted: formatMoney(p.amountMinor || 0),
            },
        })),
    };
};

/**
 * Payslip payload from Payroll line (on-demand PDF source).
 */
const getPayslipPayload = async (payrollId, companyId, user) => {
    const line = await getLineById(payrollId, companyId);
    if (!["calculated", "approved", "paid"].includes(line.status)) {
        throw new AppError(
            `Payslip available after calculation (status=${line.status}).`,
            400
        );
    }

    // BM may only view own payslip
    const role = (user?.role || "").toLowerCase();
    if (role !== "admin") {
        const Employee = require("../model/employee");
        const mine = await Employee.findOne({
            userId: user._id,
            ...NOT_DELETED,
        })
            .select("_id")
            .lean();
        if (!mine || String(line.employeeId) !== String(mine._id)) {
            throw new AppError("You can only view your own payslip.", 403);
        }
    }

    const company = await companySnapshot(companyId);
    let run = null;
    if (line.payrollRunId) {
        try {
            run = await getRunById(line.payrollRunId, companyId, {
                includeLines: false,
            });
        } catch (_) {
            run = null;
        }
    }

    // Soft-mark generated flag (idempotent)
    await Payroll.updateOne(
        { _id: line._id, companyId },
        {
            $set: {
                payslipGenerated: true,
                payslipGeneratedAt: new Date(),
                payslipNumber:
                    line.payslipNumber ||
                    `PSL-${line.payrollNumber || line._id}`,
            },
        }
    );

    return {
        documentType: "payslip",
        printable: true,
        generatedAt: new Date().toISOString(),
        company,
        currency: line.currency || DEFAULT_CURRENCY,
        run: run
            ? {
                  runNumber: run.runNumber,
                  status: run.status,
                  payrollMonth: run.payrollMonth,
                  payrollYear: run.payrollYear,
              }
            : null,
        payroll: line,
        employee: {
            employeeId: line.employeeId,
            employeeCode: line.employeeCode,
            employeeName: line.employeeName,
            designation: line.designation,
        },
        period: {
            month: line.payrollMonth,
            year: line.payrollYear,
            label: line.payrollPeriod,
        },
        attendance: {
            totalWorkingDays: line.totalWorkingDays,
            presentDays: line.presentDays,
            absentDays: line.absentDays,
            leaveDays: line.leaveDays,
            halfDays: line.halfDays,
            overtimeHours: line.overtimeHours,
            totalWorkingHours: line.totalWorkingHours,
        },
        amounts: {
            basic: toMajor(line.basicSalaryMinor || 0),
            earnings: toMajor(line.earningMinor || 0),
            deductions: toMajor(line.deductionMinor || 0),
            overtime: toMajor(line.overtimeAmountMinor || 0),
            gross: toMajor(line.grossSalaryMinor || 0),
            net: toMajor(line.netSalaryMinor || 0),
            basicFormatted: formatMoney(line.basicSalaryMinor || 0),
            grossFormatted: formatMoney(line.grossSalaryMinor || 0),
            netFormatted: formatMoney(line.netSalaryMinor || 0),
        },
        components: line.salaryComponents || [],
    };
};

const getSupplierReceiptPayload = async (paymentId, companyId) => {
    const receipt = await getSupplierPaymentReceipt(paymentId, companyId);
    const company = await companySnapshot(companyId);
    return {
        ...receipt,
        company,
        printable: true,
        documentType: "supplier_payment_receipt",
    };
};

const getEmployeeReceiptPayload = async (paymentId, companyId, user) => {
    const receipt = await getEmployeePaymentReceipt(
        paymentId,
        companyId,
        user
    );
    const company = await companySnapshot(companyId);
    return {
        ...receipt,
        company,
        printable: true,
        documentType: "employee_payment_receipt",
    };
};

module.exports = {
    getDashboard,
    getSupplierPayablesReport,
    getSupplierPaymentsReport,
    getPayrollRunsReport,
    getPayrollRunSummary,
    getEmployeeAdvancesReport,
    getEmployeePaymentsReport,
    getPayslipPayload,
    getSupplierReceiptPayload,
    getEmployeeReceiptPayload,
    companySnapshot,
};
