/**
 * Offline simulation of buildDeliveryPhases + aggregateReceiveFromGrns
 * (copied from grnService.js — keep in sync when fixing).
 */
const asNonNeg = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const lineMatchKey = (row = {}) => {
    const pid = row.productId?._id || row.productId?.id || row.productId || "";
    const vid =
        row.productVariantId?._id ||
        row.productVariantId?.id ||
        row.productVariantId ||
        "";
    return `${String(pid)}|${String(vid)}|${String(row.sku || "")}|${String(row.variantLabel || "")}`;
};

const softMatchKey = (row = {}) => {
    const pid = row.productId?._id || row.productId?.id || row.productId || "";
    const vid =
        row.productVariantId?._id ||
        row.productVariantId?.id ||
        row.productVariantId ||
        "";
    return `${String(pid)}|${String(vid)}`;
};

const linesLooselyMatch = (a = {}, b = {}) => {
    const sa = softMatchKey(a);
    const sb = softMatchKey(b);
    if (sa !== "|" && sa === sb) return true;
    const nameA = String(a.productName || "").trim().toLowerCase();
    const nameB = String(b.productName || "").trim().toLowerCase();
    const varA = String(a.variantLabel || "").trim().toLowerCase();
    const varB = String(b.variantLabel || "").trim().toLowerCase();
    if (nameA && nameA === nameB && varA === varB) return true;
    const skuA = String(a.sku || "").trim().toLowerCase();
    const skuB = String(b.sku || "").trim().toLowerCase();
    if (skuA && skuA === skuB) return true;
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
        .map((k) => (k.includes("|") ? k.split("|").slice(0, 2).join("|") : k))
        .filter((k) => k && k !== "|");
    for (const [mapKey, availRaw] of Object.entries(poolMap)) {
        const avail = Math.max(Number(availRaw) || 0, 0);
        if (avail <= 0) continue;
        const mapSoft = mapKey.split("|").slice(0, 2).join("|");
        if (!softs.includes(mapSoft)) continue;
        const take = Math.min(avail, need);
        poolMap[mapKey] = Math.max(avail - take, 0);
        return take;
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
    const softs = keys
        .map((k) => (k.includes("|") ? k.split("|").slice(0, 2).join("|") : k))
        .filter((k) => k && k !== "|");
    for (const [mapKey, availRaw] of Object.entries(taggedMap)) {
        const qty = asNonNeg(availRaw);
        if (qty <= 0) continue;
        const mapSoft = mapKey.split("|").slice(0, 2).join("|");
        if (!softs.includes(mapSoft)) continue;
        taggedMap[mapKey] = 0;
        return qty;
    }
    return 0;
};

const findPoItemForAlloc = (alloc, items = []) => {
    const full = lineMatchKey(alloc);
    for (const item of items) {
        if (lineMatchKey(item) === full) return item;
    }
    const soft = softMatchKey(alloc);
    if (soft !== "|") {
        for (const item of items) {
            if (softMatchKey(item) === soft) return item;
        }
    }
    for (const item of items) {
        if (linesLooselyMatch(alloc, item)) return item;
    }
    return null;
};

const shipmentQtyForAlloc = (phaseShipments = [], alloc, item = null) => {
    let sum = 0;
    for (const s of phaseShipments) {
        for (const l of s.lines || []) {
            if (
                linesLooselyMatch(l, alloc) ||
                (item && linesLooselyMatch(l, item))
            ) {
                sum += asNonNeg(l.quantity);
            }
        }
    }
    return sum;
};

const aggregateReceiveFromGrns = (grns = []) => {
    const damagedByKey = {};
    const acceptedByKey = {};
    const byPhase = {};
    const bump = (map, key, qty) => {
        if (!key || key === "|" || qty <= 0) return;
        map[key] = (map[key] || 0) + qty;
    };
    for (const grn of grns || []) {
        for (const batch of grn.receiveBatches || []) {
            const phaseNo = Number(batch.phase);
            const phaseBucket =
                Number.isFinite(phaseNo) && phaseNo > 0
                    ? byPhase[phaseNo] ||
                      (byPhase[phaseNo] = {
                          acceptedByKey: {},
                          damagedByKey: {}
                      })
                    : null;
            for (const line of batch.lines || []) {
                const key = lineMatchKey(line);
                const received = asNonNeg(line.receivedQuantity);
                const damaged = asNonNeg(line.damagedQuantity);
                const accepted = Math.max(
                    asNonNeg(line.acceptedQuantity) || received - damaged,
                    0
                );
                bump(acceptedByKey, key, accepted);
                bump(damagedByKey, key, damaged);
                if (phaseBucket) {
                    bump(phaseBucket.acceptedByKey, key, accepted);
                    bump(phaseBucket.damagedByKey, key, damaged);
                }
            }
        }
    }
    return { damagedByKey, acceptedByKey, byPhase };
};

const buildDeliveryPhases = (po, receiveAgg = {}) => {
    const items = po.items || [];
    const damagedByKey = receiveAgg.damagedByKey || {};
    const byPhase = receiveAgg.byPhase || {};

    const remainingRecv = {};
    const remainingDmg = {};
    for (const item of items) {
        const full = lineMatchKey(item);
        const soft = softMatchKey(item);
        const recv = asNonNeg(item.receivedQuantity);
        const dmg =
            asNonNeg(damagedByKey[full]) ||
            (() => {
                for (const [k, v] of Object.entries(damagedByKey)) {
                    if (k.split("|").slice(0, 2).join("|") === soft) {
                        return asNonNeg(v);
                    }
                }
                return 0;
            })();
        remainingRecv[full] = (remainingRecv[full] || 0) + recv;
        remainingDmg[full] = (remainingDmg[full] || 0) + dmg;
    }

    let phases = Array.isArray(po.supplierPartialSchedule)
        ? po.supplierPartialSchedule
        : [];

    if (!phases.length) {
        phases = [
            {
                phase: 1,
                isCompleted: items.every(
                    (i) =>
                        asNonNeg(i.supplierSentQuantity) + 0.0001 >=
                        asNonNeg(i.quantity)
                ),
                lineAllocations: items.map((i) => ({
                    productId: i.productId || null,
                    productVariantId: i.productVariantId || null,
                    productName: i.productName || "",
                    variantLabel: i.variantLabel || "",
                    sku: i.sku || "",
                    quantity: asNonNeg(i.quantity),
                    sentQuantity: asNonNeg(i.supplierSentQuantity)
                }))
            }
        ];
    }

    const shipments = Array.isArray(po.supplierShipments)
        ? po.supplierShipments
        : [];

    return phases.map((phase, idx) => {
        const phaseNo = Number(phase.phase) || idx + 1;
        const phaseShipments = shipments.filter(
            (s) =>
                Number(s.phase) === phaseNo ||
                (s.phase == null && phases.length === 1)
        );
        const phaseTagged = byPhase[phaseNo] || null;
        const lines = [];
        let agreedQty = 0;
        let sentQty = 0;
        let receivedQty = 0;
        let damagedQty = 0;
        let grossReceivedQty = 0;
        let pendingReceiveQty = 0;

        for (const alloc of phase.lineAllocations || []) {
            const item = findPoItemForAlloc(alloc, items);
            const fullKey = item ? lineMatchKey(item) : lineMatchKey(alloc);
            const softKey = item ? softMatchKey(item) : softMatchKey(alloc);
            const lookupKeys = [fullKey, softKey].filter(
                (k, i, arr) => k && k !== "|" && arr.indexOf(k) === i
            );
            const agreed = asNonNeg(alloc.quantity);

            let sent = asNonNeg(alloc.sentQuantity);
            if (sent <= 0) {
                sent = shipmentQtyForAlloc(phaseShipments, alloc, item);
            }
            if (sent <= 0 && phases.length === 1 && item) {
                sent = asNonNeg(item.supplierSentQuantity);
            }
            if (agreed > 0) sent = Math.min(sent, agreed);

            let recv = 0;
            let dmg = 0;
            if (phaseTagged) {
                recv = takeTagged(phaseTagged.acceptedByKey, lookupKeys);
                dmg = takeTagged(phaseTagged.damagedByKey, lookupKeys);
                const grossTagged = recv + dmg;
                if (sent > 0 && grossTagged > sent + 0.0001) {
                    const scale = sent / grossTagged;
                    recv *= scale;
                    dmg *= scale;
                }
                takePool(remainingRecv, lookupKeys, recv);
                takePool(remainingDmg, lookupKeys, dmg);
            } else {
                const receiveCap = sent;
                recv = takePool(remainingRecv, lookupKeys, receiveCap);
                dmg = takePool(
                    remainingDmg,
                    lookupKeys,
                    Math.max(receiveCap - recv, 0)
                );
            }

            const gross = recv + dmg;
            const pending = Math.max(sent - gross, 0);

            agreedQty += agreed;
            sentQty += sent;
            receivedQty += recv;
            damagedQty += dmg;
            grossReceivedQty += gross;
            pendingReceiveQty += pending;

            lines.push({
                productName: alloc.productName || item?.productName || "",
                agreedQty: agreed,
                sentQty: sent,
                receivedQty: recv,
                damagedQty: dmg,
                grossReceivedQty: gross,
                pendingReceiveQty: pending
            });
        }

        const shipmentQty = phaseShipments.reduce((sum, s) => {
            for (const l of s.lines || []) sum += asNonNeg(l.quantity);
            return sum;
        }, 0);
        const effectiveSent = sentQty > 0 ? sentQty : shipmentQty;
        const isReceiveComplete =
            effectiveSent > 0 && grossReceivedQty + 0.0001 >= effectiveSent;

        return {
            phase: phaseNo,
            isReceiveComplete,
            lines,
            totals: {
                agreedQty,
                sentQty: effectiveSent,
                receivedQty,
                damagedQty,
                grossReceivedQty,
                pendingReceiveQty
            }
        };
    });
};

const PID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const VID = "";

function basePo(overrides = {}) {
    return {
        items: [
            {
                productId: PID,
                productVariantId: VID || null,
                productName: "Widget",
                variantLabel: "",
                sku: "W-1",
                quantity: 20,
                supplierSentQuantity: 10,
                receivedQuantity: 0,
                purchasePrice: 100,
                ...((overrides.item) || {})
            }
        ],
        supplierPartialSchedule: [
            {
                phase: 1,
                isCompleted: true,
                lineAllocations: [
                    {
                        productId: PID,
                        productVariantId: VID || null,
                        productName: "Widget",
                        variantLabel: "",
                        sku: "W-1",
                        quantity: 10,
                        sentQuantity: 10
                    }
                ]
            },
            {
                phase: 2,
                isCompleted: false,
                lineAllocations: [
                    {
                        productId: PID,
                        productVariantId: VID || null,
                        productName: "Widget",
                        variantLabel: "",
                        sku: "W-1",
                        quantity: 10,
                        sentQuantity: 0
                    }
                ]
            }
        ],
        supplierShipments: [
            {
                phase: 1,
                lines: [
                    {
                        productId: PID,
                        productVariantId: VID || null,
                        productName: "Widget",
                        sku: "W-1",
                        quantity: 10
                    }
                ]
            }
        ],
        ...overrides
    };
}

function batchLine(qty, dmg = 0, extra = {}) {
    return {
        productId: PID,
        productVariantId: VID || null,
        productName: "Widget",
        variantLabel: "",
        sku: "W-1",
        receivedQuantity: qty,
        damagedQuantity: dmg,
        acceptedQuantity: Math.max(qty - dmg, 0),
        ...extra
    };
}

function run(name, po, grns) {
    const agg = aggregateReceiveFromGrns(grns);
    const phases = buildDeliveryPhases(po, agg);
    const p1 = phases[0];
    console.log("\n===", name, "===");
    console.log(
        "P1 sent=%s got=%s dmg=%s gross=%s pending=%s complete=%s",
        p1.totals.sentQty,
        p1.totals.receivedQty,
        p1.totals.damagedQty,
        p1.totals.grossReceivedQty,
        p1.totals.pendingReceiveQty,
        p1.isReceiveComplete
    );
    if (phases[1]) {
        const p2 = phases[1];
        console.log(
            "P2 sent=%s got=%s gross=%s pending=%s complete=%s",
            p2.totals.sentQty,
            p2.totals.receivedQty,
            p2.totals.grossReceivedQty,
            p2.totals.pendingReceiveQty,
            p2.isReceiveComplete
        );
    }
    return phases;
}

// Scenario A: Phase1 agreed 10 sent 10, PO received 10 → phase1 got should be 10
run(
    "A: tagged phase recv 10",
    basePo({ item: { receivedQuantity: 10, supplierSentQuantity: 10 } }),
    [
        {
            receiveBatches: [
                { phase: 1, lines: [batchLine(10)] }
            ]
        }
    ]
);

// Scenario B: Phase1 agreed 10 sent 5, PO received 5 → phase1 got 5 complete
{
    const po = basePo({
        item: { receivedQuantity: 5, supplierSentQuantity: 5 }
    });
    po.supplierPartialSchedule[0].lineAllocations[0].sentQuantity = 5;
    po.supplierPartialSchedule[0].lineAllocations[0].quantity = 10;
    po.supplierShipments[0].lines[0].quantity = 5;
    run("B: tagged phase sent 5 recv 5", po, [
        { receiveBatches: [{ phase: 1, lines: [batchLine(5)] }] }
    ]);
}

// Scenario C: sent 10 with 2 damaged (accepted 8)
run(
    "C: tagged 8+2 dmg",
    basePo({ item: { receivedQuantity: 8, supplierSentQuantity: 10 } }),
    [
        {
            receiveBatches: [
                { phase: 1, lines: [batchLine(10, 2)] }
            ]
        }
    ]
);

// Scenario D: alloc.sentQuantity=0 but shipment has 10
{
    const po = basePo({
        item: { receivedQuantity: 10, supplierSentQuantity: 10 }
    });
    po.supplierPartialSchedule[0].lineAllocations[0].sentQuantity = 0;
    run("D: sentQuantity 0, shipment 10, tagged", po, [
        { receiveBatches: [{ phase: 1, lines: [batchLine(10)] }] }
    ]);
}

// Scenario E: KEY MISMATCH — batch sku differs from PO item sku (product sku enrichment)
run(
    "E: BUG sku mismatch batch vs PO (tagged)",
    basePo({
        item: {
            receivedQuantity: 10,
            supplierSentQuantity: 10,
            sku: "" // PO item empty sku
        }
    }),
    [
        {
            receiveBatches: [
                {
                    phase: 1,
                    lines: [
                        batchLine(10, 0, { sku: "W-1" }) // GRN enriched sku
                    ]
                }
            ]
        }
    ]
);

// Scenario F: same as E but NO phase tag (FIFO)
run(
    "F: sku mismatch, NO phase tag (FIFO)",
    basePo({
        item: { receivedQuantity: 10, supplierSentQuantity: 10, sku: "" }
    }),
    [
        {
            receiveBatches: [
                {
                    phase: null,
                    lines: [batchLine(10, 0, { sku: "W-1" })]
                }
            ]
        }
    ]
);

// Scenario G: phase tagged but EMPTY phase bucket keys wrong productId
run(
    "G: BUG batch null productId vs PO productId (tagged)",
    basePo({ item: { receivedQuantity: 10, supplierSentQuantity: 10 } }),
    [
        {
            receiveBatches: [
                {
                    phase: 1,
                    lines: [
                        batchLine(10, 0, {
                            productId: null,
                            sku: "W-1",
                            productName: "Widget"
                        })
                    ]
                }
            ]
        }
    ]
);

// Scenario H: phaseTagged exists for phase1 but takeTagged fails → got 0 (repro)
// Alloc uses different variantLabel than batch
run(
    "H: BUG variantLabel mismatch full key (tagged, soft should save)",
    basePo({
        item: {
            receivedQuantity: 10,
            supplierSentQuantity: 10,
            variantLabel: "Red"
        }
    }),
    [
        {
            receiveBatches: [
                {
                    phase: 1,
                    lines: [
                        batchLine(10, 0, { variantLabel: "" })
                    ]
                }
            ]
        }
    ]
);

// Scenario I: purchaseOrderService-style [object Object] key on alloc only
{
    const populatedId = { _id: PID, name: "Widget" };
    const po = basePo();
    po.items[0].receivedQuantity = 10;
    po.supplierPartialSchedule[0].lineAllocations[0].productId = populatedId;
    // items stay as string ids
    run("I: alloc populated productId object (findPoItem soft)", po, [
        { receiveBatches: [{ phase: 1, lines: [batchLine(10)] }] }
    ]);
}

// Scenario J: untagged FIFO after partial — should attribute to phase1
run(
    "J: untagged FIFO phase1",
    basePo({ item: { receivedQuantity: 10, supplierSentQuantity: 10 } }),
    [
        {
            receiveBatches: [
                { phase: null, lines: [batchLine(10)] }
            ]
        }
    ]
);

console.log("\nDone.");
