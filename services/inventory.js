const Inventory = require("../models/inventory.model");
const StockLedger = require("../models/stockLedger.model");

async function addStock({

    warehouse,
    product,
    quantity,
    purchasePrice,
    referenceType,
    referenceId,
    createdBy,
    session

}) {

    let inventory = await Inventory.findOne({

        warehouse,
        product

    }).session(session);

    if (!inventory) {

        inventory = await Inventory.create([{

            warehouse,
            product,
            availableQty: quantity,
            lastPurchasePrice: purchasePrice

        }], { session });

        inventory = inventory[0];

    } else {

        inventory.availableQty += quantity;

        inventory.lastPurchasePrice = purchasePrice;

        await inventory.save({ session });

    }

    await StockLedger.create([{

        warehouse,

        product,

        transactionType: "Purchase",

        quantity,

        balanceAfterTransaction: inventory.availableQty,

        unitCost: purchasePrice,

        referenceType,

        referenceId,

        createdBy

    }], { session });

}

module.exports = {

    addStock

};