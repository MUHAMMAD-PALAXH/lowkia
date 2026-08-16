const mongoose = require("mongoose");
const RepairTicket = require("../model/repairTicket");
const AdminUser = require("../model/adminUser");
const SalesOrder = require("../model/salesOrder");
const Branch = require("../model/branch");
const AppError = require("../utils/appError");
const { companySnapshot } = require("./financeReportService");
const { STATUSES, SERVICE_TYPES } = require("../validators/repairReportValidator");

const DAY_MS = 86_400_000;
const OPEN_STATUSES = STATUSES.filter(
    (status) => !["Completed", "Delivered", "Cancelled"].includes(status)
);
const n = (value) => Number(value) || 0;
const id = (value) => (value == null ? "" : String(value._id || value));
const oid = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;
const escapeRegex = (value = "") =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const utcBound = (value, end = false) => {
    if (!value) return null;
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        date.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    }
    return date;
};

const resolvePeriod = (query) => {
    const to = utcBound(query.to, true) || new Date();
    const from = utcBound(query.from, false) || new Date(to.getTime() - 29 * DAY_MS);
    if (from > to) throw new AppError("'from' must be before or equal to 'to'.", 422);
    if ((to - from) / DAY_MS > 731) {
        throw new AppError("Date range cannot exceed 731 days.", 422);
    }
    const duration = to.getTime() - from.getTime() + 1;
    return {
        from,
        to,
        previousFrom: new Date(from.getTime() - duration),
        previousTo: new Date(from.getTime() - 1),
    };
};

const applyBranchScope = (match, requestedBranchId, managedBranchIds) => {
    const requested = oid(requestedBranchId);
    if (managedBranchIds === null) {
        if (requested) match.branchId = requested;
        return;
    }
    const allowed = (managedBranchIds || []).map(String);
    if (requested) {
        if (!allowed.includes(String(requested))) {
            throw new AppError("You cannot access repairs outside your branches.", 403);
        }
        match.branchId = requested;
    } else {
        match.branchId = { $in: managedBranchIds || [] };
    }
};

const tenantScope = async (companyId) => {
    const tenantId = oid(companyId);
    if (!tenantId) throw new AppError("Company context is required.", 403);
    const [creatorIds, orderIds] = await Promise.all([
        AdminUser.distinct("_id", { companyId: tenantId }),
        SalesOrder.distinct("_id", {
            companyId: tenantId,
            isDeleted: { $ne: true },
        }),
    ]);
    return {
        tenantId,
        creatorIds,
        orderIds,
        match: {
            $or: [
                { companyId: tenantId },
                { createdBy: { $in: creatorIds } },
                { sourceSalesOrderId: { $in: orderIds } },
            ],
        },
    };
};

const buildMatch = (scope, query, managedBranchIds, from, to) => {
    const match = {
        ...scope.match,
        isDeleted: { $ne: true },
        receivedDate: { $gte: from, $lte: to },
    };
    applyBranchScope(match, query.branchId, managedBranchIds);
    if (query.technicianId) match.assignedTechnician = oid(query.technicianId);
    if (query.status) match.status = query.status;
    if (query.priority) match.priority = query.priority;
    if (query.serviceType) match.serviceType = query.serviceType;
    if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) match.paymentMethod = query.paymentMethod;
    if (query.ticketSource) match.ticketSource = query.ticketSource;
    if (query.trackingType) match.trackingType = query.trackingType;
    if (query.warranty === "warranty") match.isWarranty = true;
    if (query.warranty === "nonWarranty") match.isWarranty = { $ne: true };
    if (query.search) {
        const regex = new RegExp(escapeRegex(query.search.trim()), "i");
        match.$and = [
            {
                $or: [
                    { ticketNumber: regex },
                    { repairCode: regex },
                    { barcode: regex },
                    { customerName: regex },
                    { phone: regex },
                    { serviceDetails: regex },
                    { "device.productName": regex },
                    { "device.brand": regex },
                    { "device.model": regex },
                    { "device.imei1": regex },
                    { "device.serialNumber": regex },
                ],
            },
        ];
    }
    return match;
};

const summarize = (rows, now = new Date()) => {
    const active = rows.filter((row) => row.status !== "Cancelled");
    const completed = rows.filter((row) =>
        ["Completed", "Ready For Pickup", "Delivered"].includes(row.status)
    );
    const turnaroundRows = completed.filter(
        (row) => row.completedDate && row.receivedDate
    );
    const slaRows = completed.filter(
        (row) => row.completedDate && row.expectedDeliveryDate
    );
    const overdue = rows.filter(
        (row) =>
            OPEN_STATUSES.includes(row.status) &&
            row.expectedDeliveryDate &&
            new Date(row.expectedDeliveryDate) < now
    );
    const revenue = active.reduce((sum, row) => sum + n(row.totalAmount), 0);
    return {
        totalTickets: rows.length,
        openTickets: rows.filter((row) => OPEN_STATUSES.includes(row.status)).length,
        completedTickets: completed.length,
        deliveredTickets: rows.filter((row) => row.status === "Delivered").length,
        cancelledTickets: rows.filter((row) => row.status === "Cancelled").length,
        readyForPickup: rows.filter((row) => row.status === "Ready For Pickup")
            .length,
        overdueTickets: overdue.length,
        warrantyTickets: rows.filter((row) => row.isWarranty).length,
        revenue,
        collected: active.reduce((sum, row) => sum + n(row.paidAmount), 0),
        due: active.reduce((sum, row) => sum + n(row.dueAmount), 0),
        diagnosisCharges: active.reduce(
            (sum, row) => sum + n(row.diagnosisCharge),
            0
        ),
        serviceCharges: active.reduce((sum, row) => sum + n(row.serviceCharge), 0),
        partsCharges: active.reduce((sum, row) => sum + n(row.partsCost), 0),
        laborCharges: active.reduce((sum, row) => sum + n(row.laborCost), 0),
        averageTicketValue: active.length ? revenue / active.length : 0,
        averageTurnaroundHours: turnaroundRows.length
            ? turnaroundRows.reduce(
                  (sum, row) =>
                      sum +
                      Math.max(
                          0,
                          (new Date(row.completedDate) -
                              new Date(row.receivedDate)) /
                              3_600_000
                      ),
                  0
              ) / turnaroundRows.length
            : 0,
        slaComplianceRate: slaRows.length
            ? (slaRows.filter(
                  (row) =>
                      new Date(row.completedDate) <=
                      new Date(row.expectedDeliveryDate)
              ).length /
                  slaRows.length) *
              100
            : 0,
    };
};

const comparison = (current, previous) => {
    const change = current - previous;
    return {
        current,
        previous,
        change,
        changePercent:
            previous === 0 ? (current === 0 ? 0 : null) : (change / previous) * 100,
    };
};

const periodStart = (value, groupBy) => {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    if (groupBy === "week") {
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
    } else if (groupBy === "month") {
        date.setUTCDate(1);
    }
    return date;
};

const periodKey = (value, groupBy) =>
    periodStart(value, groupBy).toISOString().slice(0, 10);

const buildTrend = (rows, from, to, groupBy) => {
    const map = new Map();
    const cursor = periodStart(from, groupBy);
    while (cursor <= to) {
        const key = cursor.toISOString().slice(0, 10);
        map.set(key, {
            period: key,
            date: key,
            label: key,
            received: 0,
            completed: 0,
            delivered: 0,
            revenue: 0,
            collected: 0,
            due: 0,
        });
        if (groupBy === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        else cursor.setUTCDate(cursor.getUTCDate() + (groupBy === "week" ? 7 : 1));
    }
    for (const row of rows) {
        const bucket = map.get(periodKey(row.receivedDate, groupBy));
        if (!bucket) continue;
        bucket.received += 1;
        if (["Completed", "Ready For Pickup", "Delivered"].includes(row.status)) {
            bucket.completed += 1;
        }
        if (row.status === "Delivered") bucket.delivered += 1;
        if (row.status !== "Cancelled") {
            bucket.revenue += n(row.totalAmount);
            bucket.collected += n(row.paidAmount);
            bucket.due += n(row.dueAmount);
        }
    }
    return [...map.values()];
};

const breakdown = (rows, field, amountField = "totalAmount") => {
    const groups = new Map();
    for (const row of rows) {
        const key = row[field] == null || row[field] === "" ? "Unspecified" : String(row[field]);
        const item = groups.get(key) || {
            id: key,
            key,
            label: key,
            count: 0,
            amount: 0,
        };
        item.count += 1;
        item.amount += n(row[amountField]);
        groups.set(key, item);
    }
    const total = rows.length;
    return [...groups.values()]
        .map((row) => ({ ...row, percentage: total ? (row.count / total) * 100 : 0 }))
        .sort((a, b) => b.count - a.count);
};

const agingBreakdown = (rows, now) => {
    const buckets = [
        { key: "0-2 days", min: 0, max: 2 },
        { key: "3-7 days", min: 3, max: 7 },
        { key: "8-14 days", min: 8, max: 14 },
        { key: "15-30 days", min: 15, max: 30 },
        { key: "31+ days", min: 31, max: Infinity },
    ];
    const open = rows.filter((row) => OPEN_STATUSES.includes(row.status));
    return buckets.map((bucket) => {
        const matches = open.filter((row) => {
            const age = Math.max(
                0,
                Math.floor((now - new Date(row.receivedDate)) / DAY_MS)
            );
            return age >= bucket.min && age <= bucket.max;
        });
        return {
            id: bucket.key,
            key: bucket.key,
            label: bucket.key,
            count: matches.length,
            amount: matches.reduce((sum, row) => sum + n(row.dueAmount), 0),
            percentage: open.length ? (matches.length / open.length) * 100 : 0,
        };
    });
};

const getDashboard = async (companyId, query = {}, managedBranchIds = null) => {
    const scope = await tenantScope(companyId);
    const period = resolvePeriod(query);
    const groupBy = query.groupBy || "day";
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
    const currentMatch = buildMatch(
        scope,
        query,
        managedBranchIds,
        period.from,
        period.to
    );
    const previousMatch = buildMatch(
        scope,
        query,
        managedBranchIds,
        period.previousFrom,
        period.previousTo
    );
    const projection =
        "branchId ticketNumber repairCode receivedDate expectedDeliveryDate completedDate pickupDate customerId customerName phone device ticketSource trackingType serviceType priority status assignedTechnician isWarranty warrantyType paymentMethod paymentStatus diagnosisCharge serviceCharge partsCost laborCost discount tax otherCharges totalAmount paidAmount dueAmount usedParts createdAt";
    const [company, rows, previousRows, total, tickets] = await Promise.all([
        companySnapshot(scope.tenantId),
        RepairTicket.find(currentMatch).select(projection).lean(),
        RepairTicket.find(previousMatch).select(projection).lean(),
        RepairTicket.countDocuments(currentMatch),
        RepairTicket.find(currentMatch)
            .select(projection)
            .populate("branchId", "branchCode name")
            .populate("assignedTechnician", "name email")
            .sort({ receivedDate: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
    ]);

    const now = new Date();
    const summary = summarize(rows, now);
    const previous = summarize(previousRows, period.previousTo);
    const branchIds = [...new Set(rows.map((row) => id(row.branchId)).filter(Boolean))];
    const technicianIds = [
        ...new Set(rows.map((row) => id(row.assignedTechnician)).filter(Boolean)),
    ];
    const [branches, technicians] = await Promise.all([
        Branch.find({ _id: { $in: branchIds.map(oid) }, isDeleted: { $ne: true } })
            .select("branchCode name")
            .lean(),
        AdminUser.find({ _id: { $in: technicianIds.map(oid) }, companyId: scope.tenantId })
            .select("name email")
            .lean(),
    ]);
    const branchMap = new Map(branches.map((row) => [id(row._id), row]));
    const technicianMap = new Map(technicians.map((row) => [id(row._id), row]));

    const entityBreakdown = (field, docs, nameField, codeField) => {
        const groups = new Map();
        for (const row of rows) {
            const key = id(row[field]) || "unassigned";
            const item = groups.get(key) || {
                id: key,
                key,
                label: "Unassigned",
                code: "",
                count: 0,
                amount: 0,
                completed: 0,
                overdue: 0,
            };
            item.count += 1;
            item.amount += row.status === "Cancelled" ? 0 : n(row.totalAmount);
            if (["Completed", "Ready For Pickup", "Delivered"].includes(row.status)) {
                item.completed += 1;
            }
            if (
                OPEN_STATUSES.includes(row.status) &&
                row.expectedDeliveryDate &&
                new Date(row.expectedDeliveryDate) < now
            ) {
                item.overdue += 1;
            }
            groups.set(key, item);
        }
        return [...groups.values()]
            .map((item) => {
                const doc = docs.get(item.id) || {};
                return {
                    ...item,
                    label: doc[nameField] || item.label,
                    code: doc[codeField] || "",
                    completionRate: item.count
                        ? (item.completed / item.count) * 100
                        : 0,
                };
            })
            .sort((a, b) => b.amount - a.amount);
    };

    const technicianPerformance = entityBreakdown(
        "assignedTechnician",
        technicianMap,
        "name",
        "email"
    ).map((item) => {
        const technicianRows = rows.filter(
            (row) => (id(row.assignedTechnician) || "unassigned") === item.id
        );
        const completedRows = technicianRows.filter(
            (row) => row.completedDate && row.receivedDate
        );
        return {
            ...item,
            averageTurnaroundHours: completedRows.length
                ? completedRows.reduce(
                      (sum, row) =>
                          sum +
                          Math.max(
                              0,
                              (new Date(row.completedDate) -
                                  new Date(row.receivedDate)) /
                                  3_600_000
                          ),
                      0
                  ) / completedRows.length
                : 0,
        };
    });

    const topDevicesMap = new Map();
    for (const row of rows) {
        const name =
            row.device?.productName ||
            row.device?.model ||
            row.serviceType ||
            "Unknown device";
        const key = `${name}|${row.device?.brand || ""}`;
        const item = topDevicesMap.get(key) || {
            id: key,
            name,
            subtitle: row.device?.brand || row.device?.model || "",
            count: 0,
            amount: 0,
            completed: 0,
        };
        item.count += 1;
        item.amount += row.status === "Cancelled" ? 0 : n(row.totalAmount);
        if (["Completed", "Ready For Pickup", "Delivered"].includes(row.status)) {
            item.completed += 1;
        }
        topDevicesMap.set(key, item);
    }

    const normalizedTickets = tickets.map((row) => {
        const branch = row.branchId || {};
        const tech = row.assignedTechnician || {};
        const ageDays = Math.max(
            0,
            Math.floor((now - new Date(row.receivedDate)) / DAY_MS)
        );
        const overdue =
            OPEN_STATUSES.includes(row.status) &&
            row.expectedDeliveryDate &&
            new Date(row.expectedDeliveryDate) < now;
        return {
            id: id(row._id),
            ticketNumber: row.ticketNumber,
            repairCode: row.repairCode || "",
            receivedDate: row.receivedDate,
            expectedDeliveryDate: row.expectedDeliveryDate,
            completedDate: row.completedDate,
            pickupDate: row.pickupDate,
            customerName: row.customerName,
            phone: row.phone,
            deviceName: row.device?.productName || row.device?.model || "Device",
            brand: row.device?.brand || "",
            model: row.device?.model || "",
            imei: row.device?.imei1 || "",
            serviceType: row.serviceType,
            priority: row.priority,
            status: row.status,
            branchId: branch._id || null,
            branchName: branch.name || "Unassigned",
            technicianId: tech._id || null,
            technicianName: tech.name || "Unassigned",
            ticketSource: row.ticketSource,
            trackingType: row.trackingType,
            isWarranty: !!row.isWarranty,
            warrantyType: row.warrantyType,
            paymentMethod: row.paymentMethod,
            paymentStatus: row.paymentStatus,
            totalAmount: n(row.totalAmount),
            paidAmount: n(row.paidAmount),
            dueAmount: n(row.dueAmount),
            ageDays,
            overdue: !!overdue,
        };
    });

    return {
        meta: {
            reportType: "repair_dashboard",
            generatedAt: now.toISOString(),
            company,
            currency: company.currency || "USD",
            timezone: "UTC",
            companyTimezone: company.timezone || null,
            filters: {
                from: period.from.toISOString(),
                to: period.to.toISOString(),
                branchId: query.branchId || null,
                technicianId: query.technicianId || null,
                status: query.status || null,
                priority: query.priority || null,
                serviceType: query.serviceType || null,
                paymentStatus: query.paymentStatus || null,
                paymentMethod: query.paymentMethod || null,
                ticketSource: query.ticketSource || null,
                trackingType: query.trackingType || null,
                warranty: query.warranty || "all",
                search: query.search || null,
                groupBy,
            },
            scope: {
                strategy: "companyId_or_tenant_creator_or_tenant_sales_order",
                tenantCreatorCount: scope.creatorIds.length,
                tenantSalesOrderCount: scope.orderIds.length,
            },
            notes: [
                "Date filters form a received-ticket cohort; completion and revenue metrics describe that cohort.",
                "Parts and labor fields are billed components, not verified accounting costs; no profit metric is inferred.",
            ],
        },
        summary,
        comparison: {
            period: {
                from: period.previousFrom.toISOString(),
                to: period.previousTo.toISOString(),
            },
            totalTickets: comparison(summary.totalTickets, previous.totalTickets),
            completedTickets: comparison(
                summary.completedTickets,
                previous.completedTickets
            ),
            revenue: comparison(summary.revenue, previous.revenue),
            collected: comparison(summary.collected, previous.collected),
            averageTurnaroundHours: comparison(
                summary.averageTurnaroundHours,
                previous.averageTurnaroundHours
            ),
        },
        trend: buildTrend(rows, period.from, period.to, groupBy),
        statusBreakdown: breakdown(rows, "status"),
        serviceTypeBreakdown: breakdown(rows, "serviceType"),
        priorityBreakdown: breakdown(rows, "priority"),
        paymentStatusBreakdown: breakdown(rows, "paymentStatus"),
        paymentMethodBreakdown: breakdown(rows, "paymentMethod"),
        warrantyBreakdown: breakdown(
            rows.map((row) => ({
                ...row,
                warrantyLabel: row.isWarranty
                    ? row.warrantyType || "Warranty"
                    : "Non-warranty",
            })),
            "warrantyLabel"
        ),
        sourceBreakdown: breakdown(rows, "ticketSource"),
        agingBreakdown: agingBreakdown(rows, now),
        branchBreakdown: entityBreakdown(
            "branchId",
            branchMap,
            "name",
            "branchCode"
        ),
        technicianPerformance,
        topDevices: [...topDevicesMap.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
        tickets: {
            items: normalizedTickets,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            },
        },
        options: {
            branches: branches.map((row) => ({
                id: id(row._id),
                label: row.name,
                code: row.branchCode || "",
            })),
            technicians: technicians.map((row) => ({
                id: id(row._id),
                label: row.name || row.email,
                code: row.email || "",
            })),
            statuses: STATUSES,
            serviceTypes: SERVICE_TYPES,
        },
    };
};

module.exports = { getDashboard };
