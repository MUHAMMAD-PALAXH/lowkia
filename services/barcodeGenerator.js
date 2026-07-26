const Counter = require("../model/counter");

// =====================================================
// EAN-13 barcode generator
//
// Rules (cursor_rules.md):
// - Only Non IMEI products get a barcode
// - ONE barcode per product, never regenerated, never reused
// - Barcode must uniquely identify the product
//
// Structure: [prefix 2][sequence 10][check digit 1] = 13 digits
// Prefix 20-29 is reserved for in-store / internal use by GS1,
// so it is safe for a private ERP and still scanner friendly.
// =====================================================

const INTERNAL_PREFIX = process.env.BARCODE_PREFIX || "20";
const COUNTER_MODULE = "barcode";
const SEQUENCE_LENGTH = 10;

const calculateCheckDigit = (digits12) => {
    let sum = 0;

    for (let i = 0; i < digits12.length; i += 1) {
        const digit = Number(digits12[i]);
        // Odd positions (1-based) weigh 1, even positions weigh 3
        sum += i % 2 === 0 ? digit : digit * 3;
    }

    const remainder = sum % 10;
    return remainder === 0 ? 0 : 10 - remainder;
};

const nextSequence = async () => {
    const counter = await Counter.findOneAndUpdate(
        { module: COUNTER_MODULE },
        {
            $inc: { lastNumber: 1 },
            $setOnInsert: {
                module: COUNTER_MODULE,
                prefix: "BAR",
                padding: 6
            }
        },
        { new: true, upsert: true }
    );

    return counter.lastNumber;
};

const buildEan13 = (sequenceNumber) => {
    const prefix = String(INTERNAL_PREFIX).padStart(2, "0").slice(0, 2);
    const sequence = String(sequenceNumber).padStart(SEQUENCE_LENGTH, "0");
    const base = `${prefix}${sequence}`.slice(0, 12);
    return `${base}${calculateCheckDigit(base)}`;
};

// Generates a unique EAN-13 barcode. Retries if the value already exists,
// which can only happen if barcodes were imported manually.
const generateProductBarcode = async () => {
    const Product = require("../model/product");

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const barcode = buildEan13(await nextSequence());

        const exists = await Product.exists({ barcode });
        if (!exists) return barcode;
    }

    throw new Error("Unable to generate a unique barcode. Please try again.");
};

const isValidEan13 = (value) => {
    const barcode = String(value || "").trim();
    if (!/^\d{13}$/.test(barcode)) return false;

    const base = barcode.slice(0, 12);
    return calculateCheckDigit(base) === Number(barcode[12]);
};

module.exports = {
    generateProductBarcode,
    calculateCheckDigit,
    isValidEan13
};
