const express = require("express");
const router = express.Router();
const repairTicketController = require("../controllers/repairTicketController");
const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");

// Base: /api/repair-tickets — authenticated only
router.use(protect, resolveTenant);

router.get("/stats", repairTicketController.getRepairTicketStats);
router.get(
    "/export/excel",
    repairTicketController.exportRepairTicketsExcel
);
router.get(
    "/lookup-imei/:imei",
    repairTicketController.lookupImeiWarranty
);

router.post("/bulk-delete", repairTicketController.bulkDeleteRepairTickets);
router.post("/bulk-restore", repairTicketController.bulkRestoreRepairTickets);
router.post(
    "/bulk-permanent-delete",
    repairTicketController.bulkPermanentDeleteRepairTickets
);

router.get("/", repairTicketController.getRepairTickets);
router.get("/:id", repairTicketController.getRepairTicketById);
router.post("/", repairTicketController.createRepairTicket);
router.put("/:id", repairTicketController.updateRepairTicket);
router.patch("/:id/status", repairTicketController.updateRepairTicketStatus);
router.patch("/:id/complete", repairTicketController.completeRepairTicket);
router.delete("/:id", repairTicketController.deleteRepairTicket);
router.delete(
    "/:id/permanent",
    repairTicketController.permanentDeleteRepairTicket
);
router.patch("/:id/restore", repairTicketController.restoreRepairTicket);

module.exports = router;
