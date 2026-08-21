/**
 * Integration smoke against live MONGO_URL (skipped if unset).
 * Covers: plans, assign subscription, mark-paid, enter/exit JWT claims.
 */
require("dotenv").config();
const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const AdminUser = require("../../model/adminUser");
const Company = require("../../model/company");
const { ROLES } = require("../../constants/roles");
const {
    ensureDefaultPlans,
    listPlans,
    assignSubscription,
    markSubscriptionPaid,
    getCompanySubscription,
} = require("../../services/subscriptionService");
const {
    ensureDefaultCompany,
    enterCompany,
    exitCompany,
} = require("../../services/companyService");

const hasMongo = Boolean(process.env.MONGO_URL);
const hasJwt = Boolean(process.env.JWT_SECRET);

async function withDb(fn) {
    if (!hasMongo) {
        console.log("    (skip — MONGO_URL not set)");
        return;
    }
    await mongoose.connect(process.env.MONGO_URL);
    try {
        await fn();
    } finally {
        await mongoose.disconnect();
    }
}

exports.assign_and_mark_paid_flow = async () => {
    await withDb(async () => {
        await ensureDefaultPlans();
        const plans = await listPlans({ activeOnly: true });
        assert.ok(plans.length >= 1, "expected seeded plans");

        const company = await ensureDefaultCompany();
        assert.ok(company?._id);

        const plan =
            plans.find((p) => p.planCode === "STARTER_MONTHLY") || plans[0];

        const sub = await assignSubscription(company._id, plan._id, null, {
            startTrial: true,
        });
        assert.ok(sub);
        assert.strictEqual(sub.status, "trialing");
        assert.strictEqual(sub.paymentStatus, "unpaid");

        const actor = {
            _id: new mongoose.Types.ObjectId(),
            role: ROLES.GLOBAL_SUPER_ADMIN,
            firstName: "Test",
            lastName: "GSA",
            email: "test-gsa@example.com",
        };

        const paid = await markSubscriptionPaid(sub._id, actor, {
            paymentNote: "Phase6 smoke",
            paymentMethod: "manual",
        });
        assert.strictEqual(paid.paymentStatus, "paid");
        assert.strictEqual(paid.status, "active");

        const refreshed = await Company.findById(company._id);
        assert.strictEqual(refreshed.status, "Active");

        const current = await getCompanySubscription(company._id);
        assert.ok(current);
        assert.strictEqual(String(current._id), String(paid._id));
    });
};

exports.enter_exit_company_jwt = async () => {
    await withDb(async () => {
        if (!hasJwt) {
            console.log("    (skip enter/exit — JWT_SECRET not set)");
            return;
        }

        let gsa = await AdminUser.findOne({
            role: ROLES.GLOBAL_SUPER_ADMIN,
            isDeleted: { $ne: true },
        });

        if (!gsa) {
            console.log("    (skip enter/exit — no Global Super Admin user)");
            return;
        }

        const company = await ensureDefaultCompany();
        // Enter requires Active/Trial — mark company Active for smoke
        if (!["Active", "Trial"].includes(company.status)) {
            company.status = "Active";
            await company.save();
        }

        const entered = await enterCompany(gsa, company._id);
        assert.ok(entered.token);
        assert.strictEqual(entered.destination, "company_erp");
        assert.ok(entered.activeCompanyId);

        const decoded = jwt.verify(entered.token, process.env.JWT_SECRET);
        assert.strictEqual(decoded.role, ROLES.GLOBAL_SUPER_ADMIN);
        assert.strictEqual(
            String(decoded.activeCompanyId),
            String(company._id)
        );

        const exited = await exitCompany(gsa, company._id);
        assert.ok(exited.token);
        assert.strictEqual(exited.destination, "global_console");
        assert.strictEqual(exited.activeCompanyId, null);

        const decodedOut = jwt.verify(exited.token, process.env.JWT_SECRET);
        assert.strictEqual(decodedOut.role, ROLES.GLOBAL_SUPER_ADMIN);
        assert.ok(!decodedOut.activeCompanyId);
    });
};

exports.resolve_tenant_strips_spoofed_companyId = async () => {
    const { resolveTenant } = require("../../middleware/tenant");

    const req = {
        user: {
            _id: new mongoose.Types.ObjectId(),
            role: ROLES.GLOBAL_SUPER_ADMIN,
            companyId: null,
        },
        body: { companyId: "hacker-spoof", name: "x" },
        query: { companyId: "hacker-spoof" },
        activeCompanyId: null,
    };

    let nextCalled = false;
    await new Promise((resolve, reject) => {
        resolveTenant(req, {}, (err) => {
            if (err) reject(err);
            else {
                nextCalled = true;
                resolve();
            }
        });
    });

    assert.ok(nextCalled);
    assert.strictEqual(req.body.companyId, undefined);
    assert.strictEqual(req.query.companyId, undefined);
    assert.strictEqual(req.companyId, null);
    assert.strictEqual(req.isPlatformMode, true);
};
