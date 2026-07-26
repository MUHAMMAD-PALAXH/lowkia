const Counter = require("../models/counter.model");

async function generateNumber(prefix) {

    const today = new Date();

    const date = today.toISOString().slice(0,10).replace(/-/g,"");

    const counter = await Counter.findOneAndUpdate(

        {
            name: prefix
        },

        {
            $inc:{
                sequence:1
            }
        },

        {
            new:true,
            upsert:true
        }

    );

    return `${prefix}-${date}-${String(counter.sequence).padStart(6,"0")}`;

}

module.exports = generateNumber;