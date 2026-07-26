const Counter = require("../model/counter");

const counters = [
    {
        module: "branch",
        prefix: "BRN",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "warehouse",
        prefix: "WH",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "supplier",
        prefix: "SUP",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "product",
        prefix: "PRD",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "employee",
        prefix: "EMP",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "purchase_order",
        prefix: "PO",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "grn",
        prefix: "GRN",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "stock_transfer",
        prefix: "ST",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "stock_adjustment",
        prefix: "SA",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "sales_order",
        prefix: "SO",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "invoice",
        prefix: "INV",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "customer",
        prefix: "CUS",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "expense",
        prefix: "EXP",
        padding: 6,
        lastNumber: 0
    },
    {
        module: "payment",
        prefix: "PAY",
        padding: 6,
        lastNumber: 0
    }
];

const seedCounters = async () => {

    for (const item of counters) {

        await Counter.updateOne(

            {
                module: item.module
            },

            {
                $setOnInsert: item
            },

            {
                upsert: true
            }

        );

    }

    console.log("✅ Counter Seeder Completed");

};

module.exports = seedCounters;
