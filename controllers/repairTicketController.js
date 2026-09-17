const asyncHandler = require("express-async-handler");
const repairTicketService = require("../services/repairTicketService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.createdBy || req.body?.actorId || null;

exports.createRepairTicket = asyncHandler(async (req, res) => {
    const doc = await repairTicketService.createRepairTicket(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket created.", doc, 201);
});

exports.getRepairTickets = asyncHandler(async (req, res) => {
    const result = await repairTicketService.getRepairTickets(
        req.query,
        req.companyId
    );
    return success(res, "Repair tickets retrieved.", result);
});

exports.getRepairTicketStats = asyncHandler(async (req, res) => {
    const stats = await repairTicketService.getRepairTicketStats(
        req.query,
        req.companyId
    );
    return success(res, "Repair ticket stats retrieved.", stats);
});

exports.getRepairTicketById = asyncHandler(async (req, res) => {
    const includeDeleted =
        req.query.deleted === "true" || req.query.trash === "true";
    const doc = await repairTicketService.getRepairTicketById(
        req.params.id,
        req.companyId,
        { includeDeleted }
    );
    return success(res, "Repair ticket retrieved.", doc);
});

exports.updateRepairTicket = asyncHandler(async (req, res) => {
    const doc = await repairTicketService.updateRepairTicket(
        req.params.id,
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket updated.", doc);
});

exports.updateRepairTicketStatus = asyncHandler(async (req, res) => {
    const doc = await repairTicketService.updateRepairTicketStatus(
        req.params.id,
        req.body?.status,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket status updated.", doc);
});

exports.completeRepairTicket = asyncHandler(async (req, res) => {
    const doc = await repairTicketService.completeRepairTicket(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket completed.", doc);
});

exports.deleteRepairTicket = asyncHandler(async (req, res) => {
    const result = await repairTicketService.deleteRepairTicket(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket moved to trash.", result);
});

exports.restoreRepairTicket = asyncHandler(async (req, res) => {
    const doc = await repairTicketService.restoreRepairTicket(
        req.params.id,
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair ticket restored from trash.", doc);
});

exports.permanentDeleteRepairTicket = asyncHandler(async (req, res) => {
    const result = await repairTicketService.permanentDeleteRepairTicket(
        req.params.id,
        req.companyId
    );
    return success(res, "Repair ticket permanently deleted.", result);
});

exports.bulkDeleteRepairTickets = asyncHandler(async (req, res) => {
    const result = await repairTicketService.bulkDeleteRepairTickets(
        req.body || {},
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair tickets moved to trash.", result);
});

exports.bulkRestoreRepairTickets = asyncHandler(async (req, res) => {
    const result = await repairTicketService.bulkRestoreRepairTickets(
        req.body || {},
        getActorId(req),
        req.companyId
    );
    return success(res, "Repair tickets restored from trash.", result);
});

exports.bulkPermanentDeleteRepairTickets = asyncHandler(async (req, res) => {
    const result = await repairTicketService.bulkPermanentDeleteRepairTickets(
        req.body || {},
        req.companyId
    );
    return success(res, "Trash items permanently deleted.", result);
});

exports.lookupImeiWarranty = asyncHandler(async (req, res) => {
    const data = await repairTicketService.lookupImeiWarranty(
        req.params.imei,
        req.companyId
    );
    return success(res, "IMEI warranty lookup completed.", data);
});
