const Counter = require("../model/counter");

// =====================================================
// EAN-13 barcode generator
//
// Shared product/variant barcodes: ONE per Non-IMEI product/variant.
// Unit barcodes: unique EAN per Non-IMEI stock unit (same counter pool).
//
// Structure: [prefix 2][sequence 10][check digit 1] = 13 digits
// Prefix 20-29 is reserved for in-store / internal use by GS1.
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

const reserveSequences = async (count = 1) => {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    const counter = await Counter.findOneAndUpdate(
        { module: COUNTER_MODULE },
        {
            $inc: { lastNumber: n },
            $setOnInsert: {
                module: COUNTER_MODULE,
                prefix: "BAR",
                padding: 6,
            },
        },
        { new: true, upsert: true }
    );

    const end = counter.lastNumber;
    const start = end - n + 1;
    return { start, end, count: n };
};

const nextSequence = async () => {
    const { end } = await reserveSequences(1);
    return end;
};

const buildEan13 = (sequenceNumber) => {
    const prefix = String(INTERNAL_PREFIX).padStart(2, "0").slice(0, 2);
    const sequence = String(sequenceNumber).padStart(SEQUENCE_LENGTH, "0");
    const base = `${prefix}${sequence}`.slice(0, 12);
    return `${base}${calculateCheckDigit(base)}`;
};

const barcodeExistsAnywhere = async (barcode) => {
    const Product = require("../model/product");
    const ProductVariant = require("../model/productVariant");
    const ProductUnitBarcode = require("../model/productUnitBarcode");

    const [onProduct, onVariant, onUnit] = await Promise.all([
        Product.exists({ barcode }),
        ProductVariant.exists({ barcode }),
        ProductUnitBarcode.exists({ barcode, isDeleted: { $ne: true } }),
    ]);
    return Boolean(onProduct || onVariant || onUnit);
};

// Generates a unique EAN-13 barcode. Retries if the value already exists,
// which can only happen if barcodes were imported manually.
const generateProductBarcode = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const barcode = buildEan13(await nextSequence());
        if (!(await barcodeExistsAnywhere(barcode))) return barcode;
    }

    throw new Error("Unable to generate a unique barcode. Please try again.");
};

/**
 * Mint many unique EAN-13 values in one counter reservation.
 * Used for Non-IMEI per-unit stock barcodes.
 */
const generateUnitBarcodes = async (count = 1) => {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n < 1) return [];

    // Same counter as product barcodes — reserved block is unique by construction.
    const { start, count: reserved } = await reserveSequences(n);
    const codes = [];
    for (let i = 0; i < reserved; i += 1) {
        codes.push(buildEan13(start + i));
    }
    return codes;
};

const isValidEan13 = (value) => {
    const barcode = String(value || "").trim();
    if (!/^\d{13}$/.test(barcode)) return false;

    const base = barcode.slice(0, 12);
    return calculateCheckDigit(base) === Number(barcode[12]);
};

module.exports = {
    generateProductBarcode,
    generateUnitBarcodes,
    calculateCheckDigit,
    isValidEan13,
};
