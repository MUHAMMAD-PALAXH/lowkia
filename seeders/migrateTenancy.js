/**
 * Phase 2: backfill companyId on tenant collections + remap legacy roles.
 *
 * Safe to re-run (idempotent).
 *
 * Env:
 *   MONGO_URL (required)
 *
 * Run: npm run migrate:tenancy
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { ensureDefaultCompany } = require("../services/companyService");
const { ROLES } = require("../constants/roles");
const AdminUser = require("../model/adminUser");

/** Mongoose model loaders → collection backfill targets */
const MODEL_LOADERS = [
    () => require("../model/branch"),
    () => require("../model/warehouse"),
    () => require("../model/category"),
    () => require("../model/subCategory"),
    () => require("../model/brand"),
    () => require("../model/variantType"),
    () => require("../model/variant"),
    () => require("../model/unit"),
    () => require("../model/product"),
    () => require("../model/productVariant"),
    () => require("../model/inventory"),
    () => require("../model/itemTrack"),
    () => require("../model/stockLedger"),
    () => require("../model/StockMovement"),
    () => require("../model/stockTransfer"),
    () => require("../model/stockAdjustment"),
    () => require("../model/branchTransfer"),
    () => require("../model/grn"),
    () => require("../model/purchaseOrder"),
    () => require("../model/purchaseReturn"),
    () => require("../model/purchaseInvoice"),
    () => require("../model/salesOrder"),
    () => require("../model/salesQuotation"),
    () => require("../model/salesInvoice"),
    () => require("../model/salesReturn"),
    () => require("../model/delivery"),
    () => require("../model/customer"),
    () => require("../model/supplier"),
    () => require("../model/supplierPayable"),
    () => require("../model/repairTicket"),
    () => require("../model/employee"),
    () => require("../model/department"),
    () => require("../model/designation"),
    () => require("../model/shift"),
    () => require("../model/attendance"),
    () => require("../model/attendancePolicy"),
    () => require("../model/attendanceCorrection"),
    () => require("../model/holiday"),
    () => require("../model/leave"),
    () => require("../model/overtimeRequest"),
    () => require("../model/payment"),
    () => require("../model/payroll"),
    () => require("../model/payrollRun"),
    () => require("../model/payslip"),
    () => require("../model/salaryStructure"),
    () => require("../model/employeeAdvance"),
    () => require("../model/employeeLoan"),
    () => require("../model/advanceSalary"),
    () => require("../model/expense"),
    () => require("../model/account"),
    () => require("../model/ledger"),
    () => require("../model/journal"),
    () => require("../model/couponCode"),
    () => require("../model/poster"),
    () => require("../model/review"),
    () => require("../model/settings"),
    () => require("../model/notification"),
    () => require("../model/notificationCenterEvent"),
    // adminNotification.js incorrectly registers as "Notification" (collides) —
    // backfilled via native collection below
    () => require("../model/activityLog"),
];

const missingCompanyFilter = {
    $or: [{ companyId: null }, { companyId: { $exists: false } }],
};

async function backfillCollection(Model, companyId) {
    const name = Model.modelName;
    if (!Model.schema.path("companyId")) {
        console.log(`  skip ${name} (no companyId path)`);
        return { name, matched: 0, modified: 0, skipped: true };
    }
    const result = await Model.updateMany(missingCompanyFilter, {
        $set: { companyId },
    });
    console.log(
        `  ${name}: matched=${result.matchedCount} modified=${result.modifiedCount}`
    );
    return {
        name,
        matched: result.matchedCount,
        modified: result.modifiedCount,
    };
}

async function migrateRoles() {
    const adminToCsa = await AdminUser.updateMany(
        { role: "admin" },
        { $set: { role: ROLES.COMPANY_SUPER_ADMIN } }
    );
    const bmToEmp = await AdminUser.updateMany(
        { role: "branch_manager" },
        { $set: { role: ROLES.EMPLOYEE } }
    );
    console.log(
        `  roles: admin→company_super_admin modified=${adminToCsa.modifiedCount}`
    );
    console.log(
        `  roles: branch_manager→employee modified=${bmToEmp.modifiedCount}`
    );
    return { adminToCsa: adminToCsa.modifiedCount, bmToEmp: bmToEmp.modifiedCount };
}

async function assignUsersToCompany(companyId) {
    const result = await AdminUser.updateMany(
        {
            role: { $ne: ROLES.GLOBAL_SUPER_ADMIN },
            ...missingCompanyFilter,
        },
        { $set: { companyId } }
    );
    // Ensure Global SA stays without company
    const gsaClear = await AdminUser.updateMany(
        { role: ROLES.GLOBAL_SUPER_ADMIN, companyId: { $ne: null } },
        { $set: { companyId: null } }
    );
    console.log(
        `  users: company assigned modified=${result.modifiedCount}; gsa cleared=${gsaClear.modifiedCount}`
    );
    return result.modifiedCount;
}

async function run() {
    if (!process.env.MONGO_URL) {
        throw new Error("MONGO_URL is required");
    }

    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connected");

    const company = await ensureDefaultCompany();
    console.log(
        `Default company: ${company.companyCode} (${company._id}) ${company.legalName}`
    );

    console.log("\nBackfilling collections...");
    const summary = [];
    for (const load of MODEL_LOADERS) {
        try {
            const Model = load();
            summary.push(await backfillCollection(Model, company._id));
        } catch (err) {
            console.error("  ERROR loading/backfilling:", err.message);
            summary.push({ error: err.message });
        }
    }

    console.log("\nMigrating roles...");
    const roles = await migrateRoles();

    console.log("\nAssigning users to default company...");
    const users = await assignUsersToCompany(company._id);

    // Native backfill for admin notification collection (model name collision)
    try {
        const colNames = (
            await mongoose.connection.db.listCollections().toArray()
        ).map((c) => c.name);
        const adminNotifCol = colNames.find((n) =>
            /admin.?notif/i.test(n)
        );
        if (adminNotifCol) {
            const r = await mongoose.connection.db
                .collection(adminNotifCol)
                .updateMany(missingCompanyFilter, {
                    $set: { companyId: company._id },
                });
            console.log(
                `\n  ${adminNotifCol}: matched=${r.matchedCount} modified=${r.modifiedCount}`
            );
        }
    } catch (err) {
        console.warn("  admin notification native backfill skipped:", err.message);
    }

    const modifiedDocs = summary.reduce(
        (n, r) => n + (r.modified || 0),
        0
    );
    console.log("\n=== Phase 2 migration complete ===");
    console.log(`Documents companyId set: ${modifiedDocs}`);
    console.log(`Users assigned: ${users}`);
    console.log(
        `Roles remapped: admin=${roles.adminToCsa}, branch_manager=${roles.bmToEmp}`
    );

    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
