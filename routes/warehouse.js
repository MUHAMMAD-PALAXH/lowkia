const express = require('express');
const router = express.Router();
const Warehouse = require('../model/warehouse');


// Get All Warehouses
router.get('/', async (req, res) => {
    try {
        const warehouses = await Warehouse.find();
        res.json(warehouses);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});


// Get Single Warehouse
router.get('/:id', async (req, res) => {
    try {
        const warehouse = await Warehouse.findById(req.params.id);

        if (!warehouse) {
            return res.status(404).json({
                message: "Warehouse not found"
            });
        }

        res.json(warehouse);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});


// Add Warehouse
router.post('/', async (req, res) => {
    try {

        // Check duplicate warehouse code

        const existingCode = await Warehouse.findOne({
            warehouseCode: req.body.warehouseCode
        });

        if (existingCode) {
            return res.status(400).json({
                message: "Warehouse code already exists"
            });
        }

        // Check duplicate warehouse name

        const existingName = await Warehouse.findOne({
            warehouseName: req.body.warehouseName
        });

        if (existingName) {
            return res.status(400).json({
                message: "Warehouse name already exists"
            });
        }

        const newWarehouse = new Warehouse(req.body);

        await newWarehouse.save();

        res.status(201).json(newWarehouse);

    } catch (error) {

        console.error("Save Error:", error.message);

        res.status(400).json({
            message: error.message,
            error
        });
    }
});


// Update Warehouse
router.put('/:id', async (req, res) => {
    try {

        // Check duplicate warehouse code

        if (req.body.warehouseCode) {

            const existingCode = await Warehouse.findOne({
                warehouseCode: req.body.warehouseCode,
                _id: { $ne: req.params.id }
            });

            if (existingCode) {
                return res.status(400).json({
                    message: "Warehouse code already exists"
                });
            }
        }

        // Check duplicate warehouse name

        if (req.body.warehouseName) {

            const existingName = await Warehouse.findOne({
                warehouseName: req.body.warehouseName,
                _id: { $ne: req.params.id }
            });

            if (existingName) {
                return res.status(400).json({
                    message: "Warehouse name already exists"
                });
            }
        }

        const updated = await Warehouse.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!updated) {
            return res.status(404).json({
                message: "Warehouse not found"
            });
        }

        res.json(updated);

    } catch (error) {

        console.error("Update Error:", error.message);

        res.status(400).json({
            message: error.message
        });
    }
});


// Delete Warehouse
router.delete('/:id', async (req, res) => {
    try {

        const deleted = await Warehouse.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({
                message: "Warehouse not found"
            });
        }

        res.json({
            message: "Warehouse deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });
    }
});


module.exports = router;

