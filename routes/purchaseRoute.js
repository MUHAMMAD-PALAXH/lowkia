const express = require("express");
const router = express.Router();

const PurchaseOrder = require("../model/purchaseOrder");


/*
|--------------------------------------------------------------------------
| CALCULATE PURCHASE TOTALS
|--------------------------------------------------------------------------
*/

function calculatePurchase(products, discount, tax, shippingCost, otherCharges, paidAmount) {

    let subtotal = 0;

    products.forEach(item => {

        item.total =
            (item.purchasePrice * item.quantity)
            - item.discount
            + item.tax;

        subtotal += item.total;

    });

    const grandTotal =
        subtotal
        - Number(discount || 0)
        + Number(tax || 0)
        + Number(shippingCost || 0)
        + Number(otherCharges || 0);

    const dueAmount = grandTotal - Number(paidAmount || 0);

    return {

        subtotal,

        grandTotal,

        dueAmount

    };

}

/*
|--------------------------------------------------------------------------
| GET ALL PURCHASE ORDERS
|--------------------------------------------------------------------------
*/

router.get("/", async (req, res) => {

    try {

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;

        const skip = (page - 1) * limit;

        const search = req.query.search || "";
        const status = req.query.status;
        const supplier = req.query.supplier;
        const warehouse = req.query.warehouse;

        let query = {};

        // Search Purchase Order Number

        if (search) {
            query.purchaseOrderNo = {
                $regex: search,
                $options: "i"
            };
        }

        // Filter by Status

        if (status) {
            query.status = status;
        }

        // Filter by Supplier

        if (supplier) {
            query.supplier = supplier;
        }

        // Filter by Warehouse

        if (warehouse) {
            query.warehouse = warehouse;
        }

        const total = await PurchaseOrder.countDocuments(query);

        const purchaseOrders = await PurchaseOrder.find(query)

            .populate("supplier")

            .populate("warehouse")

            .populate("products.product")

            .sort({ createdAt: -1 })

            .skip(skip)

            .limit(limit);

        res.json({

            total,

            page,

            totalPages: Math.ceil(total / limit),

            purchaseOrders

        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});



/*
|--------------------------------------------------------------------------
| GET SINGLE PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.get("/:id", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id)

            .populate("supplier")

            .populate("warehouse")

            .populate("products.product")

            .populate("approvedBy", "name")

            .populate("createdBy", "name");

        if (!purchaseOrder) {

            return res.status(404).json({
                message: "Purchase Order not found"
            });

        }

        res.json(purchaseOrder);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});



/*
|--------------------------------------------------------------------------
| CREATE PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.post("/", async (req, res) => {

    try {

        const exists = await PurchaseOrder.findOne({
            purchaseOrderNo: req.body.purchaseOrderNo
        });

        if (exists) {

            return res.status(400).json({
                message: "Purchase Order Number already exists"
            });

        }

        const purchaseOrder = new PurchaseOrder(req.body);

        await purchaseOrder.save();

        const newPurchaseOrder = await PurchaseOrder.findById(purchaseOrder._id)

            .populate("supplier")

            .populate("warehouse")

            .populate("products.product");

        res.status(201).json(newPurchaseOrder);

    } catch (error) {

        console.log(error);

        res.status(400).json({
            message: error.message
        });

    }

});



/*
|--------------------------------------------------------------------------
| UPDATE PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.put("/:id", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {

            return res.status(404).json({
                message: "Purchase Order not found"
            });

        }

        /*
        --------------------------------------------------------
        Draft Only
        --------------------------------------------------------
        */

        if (purchaseOrder.status !== "Draft") {

            return res.status(400).json({

                message: "Only Draft Purchase Orders can be edited."

            });

        }

        /*
        --------------------------------------------------------
        Duplicate PO Number
        --------------------------------------------------------
        */

        if (req.body.purchaseOrderNo) {

            const exists = await PurchaseOrder.findOne({

                purchaseOrderNo: req.body.purchaseOrderNo,

                _id: {
                    $ne: req.params.id
                }

            });

            if (exists) {

                return res.status(400).json({

                    message: "Purchase Order Number already exists"

                });

            }

        }

        /*
        --------------------------------------------------------
        Auto Calculate
        --------------------------------------------------------
        */

        const totals = calculatePurchase(

            req.body.products,

            req.body.discount,

            req.body.tax,

            req.body.shippingCost,

            req.body.otherCharges,

            req.body.paidAmount

        );

        req.body.subtotal = totals.subtotal;

        req.body.grandTotal = totals.grandTotal;

        req.body.dueAmount = totals.dueAmount;

        /*
        --------------------------------------------------------
        Payment Status
        --------------------------------------------------------
        */

        if (req.body.paidAmount <= 0) {

            req.body.paymentStatus = "Pending";

        }

        else if (req.body.paidAmount < totals.grandTotal) {

            req.body.paymentStatus = "Partial";

        }

        else {

            req.body.paymentStatus = "Paid";

        }

        const updated = await PurchaseOrder.findByIdAndUpdate(

            req.params.id,

            req.body,

            {

                new: true,

                runValidators: true

            }

        )

            .populate("supplier")

            .populate("warehouse")

            .populate("products.product");

        res.json(updated);

    }

    catch (error) {

        res.status(400).json({

            message: error.message

        });

    }

});


/*
|--------------------------------------------------------------------------
| DELETE PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.delete("/:id", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {

            return res.status(404).json({

                message: "Purchase Order not found"

            });

        }

        /*
        --------------------------------------------------------
        Draft Only Delete
        --------------------------------------------------------
        */

        if (purchaseOrder.status !== "Draft") {

            return res.status(400).json({

                message: "Only Draft Purchase Orders can be deleted."

            });

        }

        await PurchaseOrder.findByIdAndDelete(req.params.id);

        res.json({

            message: "Purchase Order deleted successfully."

        });

    }

    catch (error) {

        res.status(500).json({

            message: error.message

        });

    }

});


/*
|--------------------------------------------------------------------------
| SUBMIT PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.patch("/:id/submit", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {
            return res.status(404).json({
                message: "Purchase Order not found"
            });
        }

        if (purchaseOrder.status !== "Draft") {

            return res.status(400).json({
                message: "Only Draft Purchase Orders can be submitted."
            });

        }

        purchaseOrder.status = "Pending Approval";

        await purchaseOrder.save();

        res.json({
            message: "Purchase Order submitted successfully.",
            purchaseOrder
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});



/*
|--------------------------------------------------------------------------
| APPROVE PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.patch("/:id/approve", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {

            return res.status(404).json({
                message: "Purchase Order not found"
            });

        }

        if (purchaseOrder.status !== "Pending Approval") {

            return res.status(400).json({
                message: "Purchase Order is not waiting for approval."
            });

        }

        purchaseOrder.status = "Approved";

        purchaseOrder.approvedAt = new Date();

        // After authentication, replace with req.user._id
        purchaseOrder.approvedBy = req.body.approvedBy;

        await purchaseOrder.save();

        res.json({
            message: "Purchase Order approved successfully.",
            purchaseOrder
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});


/*
|--------------------------------------------------------------------------
| MARK AS ORDERED
|--------------------------------------------------------------------------
*/

router.patch("/:id/order", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {

            return res.status(404).json({
                message: "Purchase Order not found"
            });

        }

        if (purchaseOrder.status !== "Approved") {

            return res.status(400).json({
                message: "Purchase Order must be approved first."
            });

        }

        purchaseOrder.status = "Ordered";

        await purchaseOrder.save();

        res.json({
            message: "Purchase Order sent to supplier.",
            purchaseOrder
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});



/*
|--------------------------------------------------------------------------
| CANCEL PURCHASE ORDER
|--------------------------------------------------------------------------
*/

router.patch("/:id/cancel", async (req, res) => {

    try {

        const purchaseOrder = await PurchaseOrder.findById(req.params.id);

        if (!purchaseOrder) {

            return res.status(404).json({
                message: "Purchase Order not found"
            });

        }

        if (
            purchaseOrder.status === "Received"
        ) {

            return res.status(400).json({
                message: "Received Purchase Order cannot be cancelled."
            });

        }

        if (
            purchaseOrder.status === "Cancelled"
        ) {

            return res.status(400).json({
                message: "Purchase Order already cancelled."
            });

        }

        purchaseOrder.status = "Cancelled";

        await purchaseOrder.save();

        res.json({
            message: "Purchase Order cancelled successfully.",
            purchaseOrder
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});




module.exports = router;