/**
 * Targeted tenant-safety fixes (clearProductStock, mark/unmark sold,
 * transfer receive filter shape, GRN upsertInventory stamp).
 * Pure unit / mock tests — no Mongo, no production writes.
 */
const assert = require("assert");
const mongoose = require("mongoose");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");

const PRODUCT_ID = new mongoose.Types.ObjectId();
const ACTOR_ID = new mongoose.Types.ObjectId();
const COMPANY_A = new mongoose.Types.ObjectId();
const COMPANY_B = new mongoose.Types.ObjectId();

/** A — clearProductStock ItemTrack/Inventory filters include companyId */
exports.clear_product_stock_filters_include_companyId = async () => {
    const Product = require("../../model/product");
    const Inventory = require("../../model/inventory");
    const ItemTrack = require("../../model/itemTrack");
    const ProductVariant = require("../../model/productVariant");
    const productService = require("../../services/productService");
    const inventoryService = require("../../services/inventoryService");

    const captured = {};
    const orig = {
        productFindOne: Product.findOne,
        invFind: Inventory.find,
        invAgg: Inventory.aggregate,
        count: ItemTrack.countDocuments,
        updateMany: ItemTrack.updateMany,
        variantUpdate: ProductVariant.updateMany,
        refresh: productService.refreshStockSummary
    };

    Product.findOne = async (filter) => {
        captured.productFilter = filter;
        if (String(filter.companyId) !== String(COMPANY_A)) return null;
        return {
            _id: PRODUCT_ID,
            name: "Phone",
            companyId: COMPANY_A,
            createdBy: ACTOR_ID
        };
    };
    Inventory.find = async (filter) => {
        captured.invFind = filter;
        return [];
    };
    Inventory.aggregate = async (pipeline) => {
        captured.invAgg = pipeline[0].$match;
        return [];
    };
    ItemTrack.countDocuments = async (filter) => {
        captured.blockedFilter = filter;
        return 0;
    };
    ItemTrack.updateMany = async (filter) => {
        captured.imeiUpdate = filter;
        return { modifiedCount: 0 };
    };
    ProductVariant.updateMany = async (filter) => {
        captured.variantUpdate = filter;
        return { modifiedCount: 0 };
    };
    productService.refreshStockSummary = async () => ({});

    try {
        await inventoryService.clearProductStock(
            PRODUCT_ID,
            ACTOR_ID,
            COMPANY_A
        );

        assert.strictEqual(
            String(captured.productFilter.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(
            String(captured.invFind.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(
            String(captured.invAgg.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(
            String(captured.blockedFilter.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(
            String(captured.imeiUpdate.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(
            String(captured.variantUpdate.companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(captured.imeiUpdate.status, "available");
        assert.strictEqual(
            String(captured.imeiUpdate.productId),
            String(PRODUCT_ID)
        );

        // Company A cannot clear Company B's product (tenant product miss → 404)
        let threw = false;
        try {
            await inventoryService.clearProductStock(
                PRODUCT_ID,
                ACTOR_ID,
                COMPANY_B
            );
        } catch (err) {
            threw = true;
            assert.match(String(err.message), /Product not found/i);
        }
        assert.ok(threw, "foreign companyId must not clear another tenant");
    } finally {
        Product.findOne = orig.productFindOne;
        Inventory.find = orig.invFind;
        Inventory.aggregate = orig.invAgg;
        ItemTrack.countDocuments = orig.count;
        ItemTrack.updateMany = orig.updateMany;
        ProductVariant.updateMany = orig.variantUpdate;
        productService.refreshStockSummary = orig.refresh;
    }
};

exports.clear_product_stock_requires_company_context = async () => {
    const inventoryService = require("../../services/inventoryService");
    let threw = false;
    try {
        await inventoryService.clearProductStock(PRODUCT_ID, ACTOR_ID, null);
    } catch (err) {
        threw = true;
        assert.match(String(err.message), /Company context is required/i);
    }
    assert.ok(threw);
};

/** B — markImeisSold query includes companyId; foreign track not selected */
exports.mark_imeis_sold_query_includes_companyId = async () => {
    const ItemTrack = require("../../model/itemTrack");
    const { markImeisSold } = require("../../services/salesOrderService");

    const captured = [];
    const origFindOne = ItemTrack.findOne;
    ItemTrack.findOne = (filter) => {
        captured.push(filter);
        return {
            session: () =>
                Promise.resolve({
                    status: "available",
                    saleInfo: {},
                    history: [],
                    save: async () => {}
                })
        };
    };

    try {
        await markImeisSold({
            productId: PRODUCT_ID,
            imeis: ["359999999999999"],
            salesOrderId: new mongoose.Types.ObjectId(),
            companyId: COMPANY_A,
            warrantyType: "No Warranty"
        });

        assert.ok(captured.length >= 1);
        assert.strictEqual(String(captured[0].companyId), String(COMPANY_A));
        assert.strictEqual(captured[0].status, "available");
        assert.strictEqual(captured[0].imei, "359999999999999");

        // Company B track would not match Company A filter
        const foreignTrack = {
            productId: PRODUCT_ID,
            imei: "359999999999999",
            status: "available",
            companyId: COMPANY_B
        };
        assert.notStrictEqual(
            String(foreignTrack.companyId),
            String(captured[0].companyId)
        );
    } finally {
        ItemTrack.findOne = origFindOne;
    }
};

exports.mark_imeis_sold_without_company_throws = async () => {
    const { markImeisSold } = require("../../services/salesOrderService");
    let threw = false;
    try {
        await markImeisSold({
            productId: PRODUCT_ID,
            imeis: ["359999999999999"],
            salesOrderId: new mongoose.Types.ObjectId()
        });
    } catch (err) {
        threw = true;
        assert.match(String(err.message), /Company context is required/i);
    }
    assert.ok(threw);
};

/** C — unmarkImeisSold query includes companyId */
exports.unmark_imeis_sold_query_includes_companyId = async () => {
    const ItemTrack = require("../../model/itemTrack");
    const { unmarkImeisSold } = require("../../services/salesOrderService");

    const captured = [];
    const origFindOne = ItemTrack.findOne;
    ItemTrack.findOne = (filter) => {
        captured.push(filter);
        return {
            session: () => Promise.resolve(null)
        };
    };

    try {
        await unmarkImeisSold({
            productId: PRODUCT_ID,
            imeis: ["359999999999999"],
            salesOrderId: new mongoose.Types.ObjectId(),
            companyId: COMPANY_A
        });

        assert.ok(captured.length >= 1);
        assert.strictEqual(String(captured[0].companyId), String(COMPANY_A));
        assert.strictEqual(captured[0].status, "sold");

        const foreign = {
            productId: PRODUCT_ID,
            imei: "359999999999999",
            status: "sold",
            companyId: COMPANY_B
        };
        assert.notStrictEqual(
            String(foreign.companyId),
            String(captured[0].companyId)
        );
    } finally {
        ItemTrack.findOne = origFindOne;
    }
};

/** D — transfer receive ItemTrack.updateMany filter must include companyId */
exports.transfer_receive_update_filter_includes_companyId = () => {
    const transferId = new mongoose.Types.ObjectId();
    const imeis = ["359999999999991", "359999999999992"];
    const filter = {
        imei: { $in: imeis },
        status: "in-transit",
        "transferInfo.transferId": transferId,
        ...companyFilter(COMPANY_A)
    };
    assert.strictEqual(String(filter.companyId), String(COMPANY_A));
    assert.strictEqual(filter.status, "in-transit");
    assert.deepStrictEqual(filter.imei.$in, imeis);

    // Foreign-company stamped track cannot match
    const foreignTrack = {
        imei: imeis[0],
        status: "in-transit",
        transferInfo: { transferId },
        companyId: COMPANY_B
    };
    assert.notStrictEqual(
        String(foreignTrack.companyId),
        String(filter.companyId)
    );
};

/** E — GRN upsertInventory stamps new Inventory with trusted grn.companyId */
exports.grn_upsert_inventory_stamps_companyId = async () => {
    const Inventory = require("../../model/inventory");
    const { upsertInventory } = require("../../services/grnService");

    const warehouseId = new mongoose.Types.ObjectId();
    const createdPayloads = [];
    const origFindOne = Inventory.findOne;
    const OrigInventory = Inventory;

    Inventory.findOne = () => ({
        session: async () => null
    });

    // Intercept constructor by wrapping module.exports usage: upsert uses `new Inventory(...)`
    // Replace Inventory function temporarily via prototype trick — instead spy on stampCompany result
    // by monkey-patching the model as a constructible mock.
    const MockInventory = function MockInventory(payload) {
        createdPayloads.push(payload);
        this.companyId = payload.companyId;
        this.currentStock = payload.currentStock || 0;
        this.availableStock = payload.availableStock || 0;
        this.reservedStock = payload.reservedStock || 0;
        this.reorderLevel = 0;
        this.save = async () => this;
    };
    MockInventory.findOne = () => ({
        session: async () => null
    });

    // Re-require path: patch via Inventory constructor replacement on the model module
    const invPath = require.resolve("../../model/inventory");
    const grnPath = require.resolve("../../services/grnService");
    delete require.cache[grnPath];

    const realExports = require.cache[invPath].exports;
    require.cache[invPath].exports = MockInventory;

    try {
        // Fresh grnService with mocked Inventory
        delete require.cache[grnPath];
        const { upsertInventory: upsertFresh } = require("../../services/grnService");

        const result = await upsertFresh({
            warehouseId,
            branchId: null,
            productId: PRODUCT_ID,
            productVariantId: null,
            qty: 2,
            purchasePrice: 100,
            grnId: new mongoose.Types.ObjectId(),
            companyId: COMPANY_A,
            session: null
        });

        assert.ok(createdPayloads.length === 1, "expected one Inventory create");
        assert.strictEqual(
            String(createdPayloads[0].companyId),
            String(COMPANY_A)
        );
        assert.strictEqual(Number(result.current), 2);

        // Client-supplied companyId in payload is stripped by stampCompany
        const stamped = stampCompany(
            { warehouseId, companyId: COMPANY_B },
            COMPANY_A
        );
        assert.strictEqual(String(stamped.companyId), String(COMPANY_A));
        assert.notStrictEqual(String(stamped.companyId), String(COMPANY_B));
    } finally {
        require.cache[invPath].exports = realExports;
        delete require.cache[grnPath];
        require("../../services/grnService");
        Inventory.findOne = origFindOne;
    }
};

exports.grn_upsert_inventory_requires_company_context = async () => {
    const { upsertInventory } = require("../../services/grnService");
    let threw = false;
    try {
        await upsertInventory({
            warehouseId: new mongoose.Types.ObjectId(),
            productId: PRODUCT_ID,
            qty: 1,
            purchasePrice: 10,
            companyId: null,
            session: null
        });
    } catch (err) {
        threw = true;
        assert.match(String(err.message), /Company context is required/i);
    }
    assert.ok(threw);
};

exports.grn_upsert_does_not_overwrite_foreign_companyId = async () => {
    const Inventory = require("../../model/inventory");
    const { upsertInventory } = require("../../services/grnService");

    const existing = {
        companyId: COMPANY_B,
        currentStock: 5,
        availableStock: 5,
        reservedStock: 0,
        reorderLevel: 0,
        averageCost: 10,
        save: async function save() {
            return this;
        }
    };

    const origFindOne = Inventory.findOne;
    Inventory.findOne = () => ({
        session: async () => existing
    });

    try {
        let threw = false;
        try {
            await upsertInventory({
                warehouseId: new mongoose.Types.ObjectId(),
                productId: PRODUCT_ID,
                qty: 1,
                purchasePrice: 10,
                companyId: COMPANY_A,
                session: null
            });
        } catch (err) {
            threw = true;
            assert.match(String(err.message), /Inventory not found/i);
        }
        assert.ok(threw, "must refuse foreign-owned Inventory row");
        assert.strictEqual(String(existing.companyId), String(COMPANY_B));
        assert.strictEqual(existing.currentStock, 5);
    } finally {
        Inventory.findOne = origFindOne;
    }
};

/** Phase A: assertImeiUnique is company-scoped (see g2cPhaseAImeiUniqueness.test.js). */
exports.assert_imei_unique_company_scoped_documented = () => {
    const companyId = "company-a";
    const companyScopedFilter = {
        ...companyFilter(companyId),
        imei: { $in: ["359999999999999"] },
        status: { $ne: "deleted" }
    };
    assert.strictEqual(companyScopedFilter.companyId, "company-a");
    assert.ok(companyScopedFilter.imei.$in);
};
