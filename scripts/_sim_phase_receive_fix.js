/**
 * Standalone simulation of the fixed buildDeliveryPhases attribution rules.
 * Run: node scripts/_sim_phase_receive_fix.js
 */
const asNonNeg = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const idStr = (v) => String(v?._id || v?.id || v || "");
const lineMatchKey = (row = {}) =>
    `${idStr(row.productId)}|${idStr(row.productVariantId)}|${String(row.sku || "")}|${String(row.variantLabel || "")}`;
const softMatchKey = (row = {}) =>
    `${idStr(row.productId)}|${idStr(row.productVariantId)}`;
const linesLooselyMatch = (a = {}, b = {}) => {
    const sa = softMatchKey(a);
    const sb = softMatchKey(b);
    if (sa !== "|" && sa === sb) return true;
    const nameA = String(a.productName || "").trim().toLowerCase();
    const nameB = String(b.productName || "").trim().toLowerCase();
    const varA = String(a.variantLabel || "").trim().toLowerCase();
    const varB = String(b.variantLabel || "").trim().toLowerCase();
    if (nameA && nameA === nameB && varA === varB) return true;
    return false;
};

const takePool = (poolMap, keys, amount) => {
    const need = Math.max(amount, 0);
    if (need <= 0) return 0;
    for (const key of keys) {
        if (!key || key === "|") continue;
        const avail = Math.max(Number(poolMap[key]) || 0, 0);
        if (avail <= 0) continue;
        const take = Math.min(avail, need);
        poolMap[key] = Math.max(avail - take, 0);
        return take;
    }
    const softs = keys
        .map((k) => (String(k).includes("|") ? String(k).split("|").slice(0, 2).join("|") : k))
        .filter((k) => k && k !== "|");
    for (const [mapKey, availRaw] of Object.entries(poolMap)) {
        const avail = Math.max(Number(availRaw) || 0, 0);
        if (avail <= 0) continue;
        const mapSoft = String(mapKey).split("|").slice(0, 2).join("|");
        if (!softs.includes(mapSoft) && !String(mapKey).startsWith("poi:")) continue;
        if (softs.includes(mapSoft) || keys.includes(mapKey)) {
            const take = Math.min(avail, need);
            poolMap[mapKey] = Math.max(avail - take, 0);
            return take;
        }
    }
    return 0;
};

const takeTagged = (taggedMap, keys) => {
    if (!taggedMap) return 0;
    for (const key of keys) {
        if (!key || key === "|") continue;
        const qty = asNonNeg(taggedMap[key]);
        if (qty <= 0) continue;
        taggedMap[key] = 0;
        return qty;
    }
    return 0;
};

function buildPhases(po, receiveAgg = {}) {
    const items = po.items || [];
    const damagedByKey = receiveAgg.damagedByKey || {};
    const byPhase = receiveAgg.byPhase || {};
    const remainingRecv = {};
    const remainingDmg = {};
    for (const item of items) {
        const full = lineMatchKey(item);
        const poiKey = item._id ? `poi:${String(item._id)}` : null;
        const storeKey = poiKey || full;
        const recv = asNonNeg(item.receivedQuantity);
        let dmg = asNonNeg(item.damagedQuantity);
        if (dmg <= 0) dmg = asNonNeg(damagedByKey[storeKey]) || asNonNeg(damagedByKey[full]);
        remainingRecv[storeKey] = (remainingRecv[storeKey] || 0) + recv;
        remainingDmg[storeKey] = (remainingDmg[storeKey] || 0) + dmg;
    }
    const phases = po.supplierPartialSchedule || [];
    const shipments = po.supplierShipments || [];
    return phases.map((phase, idx) => {
        const phaseNo = Number(phase.phase) || idx + 1;
        const phaseShipments = shipments.filter((s) => Number(s.phase) === phaseNo);
        const phaseTagged = byPhase[phaseNo] || null;
        let sentQty = 0, receivedQty = 0, damagedQty = 0, grossReceivedQty = 0, pendingReceiveQty = 0, agreedQty = 0;
        for (const alloc of phase.lineAllocations || []) {
            const item =
                items.find((i) => lineMatchKey(i) === lineMatchKey(alloc)) ||
                items.find((i) => softMatchKey(i) === softMatchKey(alloc) && softMatchKey(i) !== "|") ||
                items.find((i) => linesLooselyMatch(i, alloc));
            const fullKey = item ? lineMatchKey(item) : lineMatchKey(alloc);
            const softKey = item ? softMatchKey(item) : softMatchKey(alloc);
            const poiKey = item?._id ? `poi:${String(item._id)}` : null;
            const lookupKeys = [poiKey, fullKey, softKey].filter((k, i, arr) => k && k !== "|" && arr.indexOf(k) === i);
            const agreed = asNonNeg(alloc.quantity);
            let sent = asNonNeg(alloc.sentQuantity);
            if (sent <= 0) {
                sent = phaseShipments.reduce((sum, s) => {
                    for (const l of s.lines || []) {
                        if (linesLooselyMatch(l, alloc) || (item && linesLooselyMatch(l, item))) {
                            sum += asNonNeg(l.quantity);
                        }
                    }
                    return sum;
                }, 0);
            }
            if (agreed > 0) sent = Math.min(sent, agreed);
            let recv = 0, dmg = 0;
            if (phaseTagged) {
                recv = takeTagged(phaseTagged.acceptedByKey, lookupKeys);
                dmg = takeTagged(phaseTagged.damagedByKey, lookupKeys);
                if (recv <= 0 && dmg <= 0) {
                    recv = takePool(remainingRecv, lookupKeys, sent);
                    dmg = takePool(remainingDmg, lookupKeys, Math.max(sent - recv, 0));
                } else {
                    takePool(remainingRecv, lookupKeys, recv);
                    takePool(remainingDmg, lookupKeys, dmg);
                }
            } else {
                recv = takePool(remainingRecv, lookupKeys, sent);
                dmg = takePool(remainingDmg, lookupKeys, Math.max(sent - recv, 0));
            }
            const gross = recv + dmg;
            agreedQty += agreed;
            sentQty += sent;
            receivedQty += recv;
            damagedQty += dmg;
            grossReceivedQty += gross;
            pendingReceiveQty += Math.max(sent - gross, 0);
        }
        const isReceiveComplete =
            sentQty > 0 && grossReceivedQty + 0.0001 >= sentQty && pendingReceiveQty <= 0.0001;
        return { phase: phaseNo, totals: { agreedQty, sentQty, receivedQty, damagedQty, grossReceivedQty, pendingReceiveQty }, isReceiveComplete };
    });
}

function assert(name, cond, detail) {
    if (!cond) {
        console.error(`FAIL ${name}:`, detail);
        process.exitCode = 1;
    } else {
        console.log(`PASS ${name}`);
    }
}

// G: tagged batch with null productId (old bug) + PO has received — must FIFO-fallback
{
    const po = {
        items: [{ _id: "poi1", productId: "abc123", productName: "Phone", sku: "W-1", quantity: 10, receivedQuantity: 10, damagedQuantity: 0, supplierSentQuantity: 10, purchasePrice: 100 }],
        supplierPartialSchedule: [{
            phase: 1,
            lineAllocations: [{ productId: "abc123", productName: "Phone", sku: "W-1", quantity: 10, sentQuantity: 10 }]
        }],
        supplierShipments: [{ phase: 1, lines: [{ productId: "abc123", productName: "Phone", sku: "W-1", quantity: 10 }] }]
    };
    // Tagged under wrong key (null productId) — simulates snapshot-before-link
    const receiveAgg = {
        damagedByKey: {},
        byPhase: {
            1: {
                acceptedByKey: { "||W-1|": 10 },
                damagedByKey: {}
            }
        }
    };
    const phases = buildPhases(po, receiveAgg);
    assert("G tagged-miss FIFO fallback", phases[0].isReceiveComplete && phases[0].totals.receivedQty === 10, phases[0]);
}

// A: happy tagged with poi key
{
    const po = {
        items: [{ _id: "poi1", productId: "abc", productName: "X", quantity: 10, receivedQuantity: 8, damagedQuantity: 2, supplierSentQuantity: 10 }],
        supplierPartialSchedule: [{ phase: 1, lineAllocations: [{ productId: "abc", productName: "X", quantity: 10, sentQuantity: 10 }] }],
        supplierShipments: []
    };
    const receiveAgg = {
        damagedByKey: { "poi:poi1": 2 },
        byPhase: { 1: { acceptedByKey: { "poi:poi1": 8 }, damagedByKey: { "poi:poi1": 2 } } }
    };
    const phases = buildPhases(po, receiveAgg);
    assert("A tagged 8+2 complete", phases[0].isReceiveComplete && phases[0].totals.grossReceivedQty === 10, phases[0]);
}

// Multi phase: phase1 done, phase2 pending
{
    const po = {
        items: [{ _id: "poi1", productId: "abc", productName: "X", quantity: 20, receivedQuantity: 10, damagedQuantity: 0, supplierSentQuantity: 10 }],
        supplierPartialSchedule: [
            { phase: 1, lineAllocations: [{ productId: "abc", productName: "X", quantity: 10, sentQuantity: 10 }] },
            { phase: 2, lineAllocations: [{ productId: "abc", productName: "X", quantity: 10, sentQuantity: 0 }] }
        ],
        supplierShipments: [{ phase: 1, lines: [{ productId: "abc", productName: "X", quantity: 10 }] }]
    };
    const phases = buildPhases(po, { damagedByKey: {}, byPhase: {} });
    assert("multi p1 complete", phases[0].isReceiveComplete, phases[0]);
    assert("multi p2 awaiting", !phases[1].isReceiveComplete && phases[1].totals.sentQty === 0, phases[1]);
}

if (!process.exitCode) console.log("\nAll simulations passed.");
