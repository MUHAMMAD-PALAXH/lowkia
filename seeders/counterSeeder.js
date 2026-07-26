const Counter = require("../model/counter");

const counters = [
    {
        module: "supplier",
        prefix: "SUP",
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
        module: "branch",
        prefix: "BR",
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