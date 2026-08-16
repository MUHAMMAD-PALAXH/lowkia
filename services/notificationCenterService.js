const NotificationCenterEvent = require("../model/notificationCenterEvent");
const Branch = require("../model/branch");
const Warehouse = require("../model/warehouse");
const AdminUser = require("../model/adminUser");

const MODULES = [
    {
        paths: ["/admin-users"],
        category: "permission",
        screen: "AccountPermission",
        label: "Account permission",
        roles: ["admin"],
    },
    {
        paths: ["/payment", "/api/payments", "/api/customer-payments"],
        category: "payment",
        screen: "Finance",
        label: "Payment",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/orders"],
        category: "online_order",
        screen: "Order",
        label: "Online order",
        roles: ["admin", "branch_manager", "vendor"],
    },
    {
        paths: ["/api/sales-orders"],
        category: "sales_order",
        screen: "SalesOrders",
        label: "Sales order",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/purchase-orders"],
        category: "purchase_order",
        screen: "PurchaseOrders",
        label: "Purchase order",
        roles: ["admin", "branch_manager", "vendor"],
    },
    {
        paths: ["/api/grn"],
        category: "grn",
        screen: "GRN",
        label: "GRN",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/repair-tickets"],
        category: "repair",
        screen: "RepairTickets",
        label: "Repair ticket",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/suppliers"],
        category: "supplier",
        screen: "Supplier",
        label: "Supplier",
        roles: ["admin", "branch_manager", "vendor"],
    },
    {
        paths: ["/api/branches"],
        category: "branch",
        screen: "Branches",
        label: "Branch",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/inventory", "/api/imei-inventory"],
        category: "stock",
        screen: "StockManagement",
        label: "Stock",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/warehouses"],
        category: "warehouse",
        screen: "Warehouse",
        label: "Warehouse",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/api/sales-returns", "/api/purchase-returns"],
        category: "return",
        screen: "SalesReturns",
        label: "Return",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/products", "/api/products"],
        category: "product",
        screen: "Products",
        label: "Product",
        roles: ["admin", "branch_manager", "vendor"],
    },
    {
        paths: [
            "/api/attendances",
            "/api/leaves",
            "/api/attendance-corrections",
            "/api/overtime-requests",
            "/api/employees",
        ],
        category: "attendance",
        screen: "Attendance",
        label: "Attendance",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: [
            "/api/expenses",
            "/api/payroll-runs",
            "/api/salary-structures",
            "/api/employee-advances",
            "/api/employee-payments",
            "/api/supplier-payables",
            "/api/supplier-payments",
            "/api/journals",
        ],
        category: "finance",
        screen: "Finance",
        label: "Finance",
        roles: ["admin"],
    },
    {
        paths: ["/api/customers"],
        category: "update",
        screen: "Customers",
        label: "Customer",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/categories", "/subCategories", "/brands", "/variantTypes", "/variants"],
        category: "product",
        screen: "Products",
        label: "Catalog",
        roles: ["admin", "branch_manager"],
    },
    {
        paths: ["/couponCodes"],
        category: "update",
        screen: "Coupon",
        label: "Coupon",
        roles: ["admin"],
    },
    {
        paths: ["/posters"],
        category: "update",
        screen: "Poster",
        label: "Poster",
        roles: ["admin"],
    },
    {
        paths: ["/api/settings", "/api/company"],
        category: "update",
        screen: "Dashboard",
        label: "Workspace",
        roles: ["admin"],
    },
    {
        paths: ["/notification"],
        category: "update",
        screen: "Notifications",
        label: "Push campaign",
        roles: ["admin"],
    },
];

const resolveModule = (path) => {
    const normalized = String(path || "").toLowerCase();
    return MODULES.find((item) =>
        item.paths.some(
            (prefix) =>
                normalized === prefix ||
                normalized.startsWith(`${prefix}/`) ||
                normalized.startsWith(`${prefix}?`)
        )
    );
};

const actionFromRequest = (method, path) => {
    const lower = String(path || "").toLowerCase();
    if (lower.includes("approve")) return "approved";
    if (lower.includes("reject")) return "rejected";
    if (lower.includes("cancel")) return "cancelled";
    if (lower.includes("restore")) return "restored";
    if (lower.includes("pay")) return "paid";
    if (lower.includes("receive")) return "received";
    if (lower.includes("transfer")) return "transferred";
    if (lower.includes("check-in")) return "checked in";
    if (lower.includes("check-out")) return "checked out";
    if (lower.includes("break")) return "updated";
    if (method === "POST") return "created";
    if (method === "PUT" || method === "PATCH") return "updated";
    if (method === "DELETE") return "deleted";
    return "updated";
};

const pickEntity = (responseBody, req) => {
    const data = responseBody && typeof responseBody === "object"
        ? responseBody.data
        : null;
    const candidate = Array.isArray(data)
        ? data[0]
        : data && typeof data === "object"
            ? (data.item || data.result || data.document || data)
            : {};
    const paramsId = req.params && (req.params.id || req.params.itemId);
    const entityId =
        candidate?._id ||
        candidate?.id ||
        candidate?.sId ||
        paramsId ||
        "";
    const entityLabel =
        candidate?.orderNumber ||
        candidate?.salesOrderNumber ||
        candidate?.purchaseOrderNumber ||
        candidate?.grnNumber ||
        candidate?.ticketNumber ||
        candidate?.referenceNumber ||
        candidate?.name ||
        candidate?.title ||
        candidate?.email ||
        "";
    return {
        entityId: entityId ? String(entityId) : "",
        entityLabel: entityLabel ? String(entityLabel) : "",
        companyId:
            candidate?.companyId?._id ||
            candidate?.companyId ||
            responseBody?.companyId ||
            null,
        branchId:
            candidate?.branchId?._id ||
            candidate?.branchId ||
            req.body?.branchId ||
            null,
    };
};

const actorName = (user) => {
    if (!user) return "System";
    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    return name || user.username || user.email || "User";
};

const resolveCompanyFromBranch = async (branchId) => {
    if (!branchId) return null;
    const branch = await Branch.findById(branchId)
        .select("managerId warehouseIds")
        .lean();
    if (!branch) return null;
    if (branch.managerId) {
        const manager = await AdminUser.findById(branch.managerId)
            .select("companyId")
            .lean();
        if (manager?.companyId) return manager.companyId;
    }
    if (branch.warehouseIds?.length) {
        const warehouse = await Warehouse.findOne({
            _id: { $in: branch.warehouseIds },
            companyId: { $ne: null },
        })
            .select("companyId")
            .lean();
        if (warehouse?.companyId) return warehouse.companyId;
    }
    return null;
};

const priorityFor = (action, category, responseBody) => {
    if (["rejected", "cancelled", "deleted"].includes(action)) return "high";
    const status = String(
        responseBody?.data?.status || responseBody?.status || ""
    ).toLowerCase();
    if (status.includes("failed") || status.includes("overdue")) return "critical";
    if (category === "payment" || category === "finance") return "high";
    return "normal";
};

const emitNotification = async (payload) => {
    try {
        if (!payload?.companyId) return null;
        return await NotificationCenterEvent.create({
            audienceRoles: ["admin", "branch_manager"],
            category: "system",
            eventType: "updated",
            priority: "normal",
            title: "Workspace updated",
            message: "A workspace update was recorded.",
            screen: "Dashboard",
            source: "system",
            ...payload,
        });
    } catch (error) {
        console.warn("[NotificationCenter] emit failed:", error.message);
        return null;
    }
};

const captureMutation = async ({ req, responseBody, statusCode }) => {
    try {
        if (statusCode < 200 || statusCode >= 300) return null;
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return null;
        const module = resolveModule(req.baseUrl || req.originalUrl);
        if (!module) return null;

        const entity = pickEntity(responseBody, req);
        let companyId =
            req.companyId ||
            req.user?.companyId?._id ||
            req.user?.companyId ||
            entity.companyId;
        if (!companyId && entity.branchId) {
            companyId = await resolveCompanyFromBranch(entity.branchId);
        }
        if (!companyId) return null;

        const action = actionFromRequest(req.method, req.originalUrl);
        const subject = entity.entityLabel
            ? `${module.label} ${entity.entityLabel}`
            : module.label;
        const actor = actorName(req.user);
        return await emitNotification({
            companyId,
            branchId: entity.branchId || null,
            audienceRoles: module.roles,
            category: module.category,
            eventType: action.replaceAll(" ", "_"),
            priority: priorityFor(action, module.category, responseBody),
            title: `${subject} ${action}`,
            message: `${actor} ${action} ${subject.toLowerCase()}.`,
            entityType: module.label.replaceAll(" ", ""),
            entityId: entity.entityId,
            entityLabel: entity.entityLabel,
            screen: module.screen,
            actor: {
                userId: req.user?._id || null,
                name: actor,
                role: req.user?.role || "system",
            },
            metadata: {
                method: req.method,
                path: req.originalUrl.split("?")[0],
            },
            source: "api",
        });
    } catch (error) {
        console.warn("[NotificationCenter] capture failed:", error.message);
        return null;
    }
};

module.exports = {
    MODULES,
    emitNotification,
    captureMutation,
};
