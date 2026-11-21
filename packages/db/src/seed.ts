import type { Repositories } from './repositories/index.ts';

/**
 * Demo data (plan §9, M1): a small category tree with custom fields, locations, items and a
 * project with reservations. Only runs on an empty database; returns false otherwise.
 * Quantities are base units: pieces, or millimetres for wire.
 */
export async function seedDemoData(repos: Repositories): Promise<boolean> {
	const existing = await repos.categories.list();
	if (existing.length > 0) return false;

	await repos.transaction(async (r) => {
		// ---- Categories ----
		const electronics = await r.categories.create({
			name: 'Electronics',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{ key: 'manufacturer', label: 'Manufacturer', type: 'text', filterable: true, order: 1 },
				{ key: 'mpn', label: 'Manufacturer part number', type: 'text', order: 2 },
				{ key: 'datasheet', label: 'Datasheet', type: 'url', searchable: false, order: 3 }
			]
		});
		const passives = await r.categories.create({
			name: 'Passives',
			parentId: electronics.id,
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{
					key: 'package',
					label: 'Package',
					type: 'enum',
					options: ['0402', '0603', '0805', '1206', 'THT'],
					filterable: true,
					showInList: true,
					order: 10
				}
			]
		});
		const resistors = await r.categories.create({
			name: 'Resistors',
			parentId: passives.id,
			skuPrefix: 'RES-',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{
					key: 'resistance',
					label: 'Resistance',
					type: 'quantity',
					unit: 'Ω',
					required: true,
					filterable: true,
					showInList: true,
					order: 20
				},
				{
					key: 'tolerance',
					label: 'Tolerance',
					type: 'enum',
					options: ['0.1%', '1%', '5%'],
					filterable: true,
					showInList: true,
					order: 21
				},
				{ key: 'power_w', label: 'Power (W)', type: 'number', min: 0, order: 22 }
			]
		});
		const capacitors = await r.categories.create({
			name: 'Capacitors',
			parentId: passives.id,
			skuPrefix: 'CAP-',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{
					key: 'capacitance',
					label: 'Capacitance',
					type: 'quantity',
					unit: 'F',
					required: true,
					filterable: true,
					showInList: true,
					order: 20
				},
				{
					key: 'voltage_v',
					label: 'Voltage (V)',
					type: 'number',
					min: 0,
					filterable: true,
					order: 21
				},
				{
					key: 'dielectric',
					label: 'Dielectric',
					type: 'enum',
					options: ['C0G', 'X7R', 'X5R', 'Y5V', 'Electrolytic', 'Tantalum'],
					filterable: true,
					order: 22
				}
			]
		});
		const ics = await r.categories.create({
			name: 'ICs',
			parentId: electronics.id,
			skuPrefix: 'IC-',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{ key: 'function', label: 'Function', type: 'text', showInList: true, order: 20 },
				{ key: 'ic_package', label: 'Package', type: 'text', filterable: true, order: 21 },
				{ key: 'pins', label: 'Pins', type: 'number', integer: true, min: 1, order: 22 }
			]
		});
		const wire = await r.categories.create({
			name: 'Wire',
			skuPrefix: 'WIR-',
			unitKind: 'length',
			displayUnit: 'm',
			fieldDefs: [
				{
					key: 'gauge_awg',
					label: 'Gauge (AWG)',
					type: 'number',
					integer: true,
					filterable: true,
					showInList: true,
					order: 1
				},
				{
					key: 'color',
					label: 'Colour',
					type: 'enum',
					options: ['black', 'red', 'blue', 'green', 'yellow', 'white'],
					filterable: true,
					showInList: true,
					order: 2
				},
				{ key: 'stranded', label: 'Stranded', type: 'boolean', filterable: true, order: 3 },
				{
					key: 'insulation',
					label: 'Insulation',
					type: 'enum',
					options: ['PVC', 'Silicone', 'PTFE'],
					filterable: true,
					order: 4
				}
			]
		});
		const tools = await r.categories.create({
			name: 'Tools',
			skuPrefix: 'TOL-',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{
					key: 'brand',
					label: 'Brand',
					type: 'text',
					filterable: true,
					showInList: true,
					order: 1
				},
				{ key: 'model', label: 'Model', type: 'text', order: 2 },
				{ key: 'serial', label: 'Serial number', type: 'text', searchable: false, order: 3 },
				{ key: 'purchase_date', label: 'Purchase date', type: 'date', order: 4 },
				{
					key: 'tags',
					label: 'Tags',
					type: 'multi_enum',
					options: ['crimping', 'cutting', 'measuring', 'soldering'],
					filterable: true,
					order: 5
				}
			]
		});

		// ---- Locations ----
		const workshop = await r.locations.create({ name: 'Workshop', code: 'WS' });
		const shelfA = await r.locations.create({
			name: 'Shelf A',
			code: 'WS-A',
			parentId: workshop.id
		});
		const binA1 = await r.locations.create({
			name: 'Bin A1 (resistors)',
			code: 'A1',
			parentId: shelfA.id
		});
		const binA2 = await r.locations.create({
			name: 'Bin A2 (capacitors)',
			code: 'A2',
			parentId: shelfA.id
		});
		const binA3 = await r.locations.create({
			name: 'Bin A3 (ICs)',
			code: 'A3',
			parentId: shelfA.id
		});
		const rack = await r.locations.create({
			name: 'Wire rack',
			code: 'WS-WR',
			parentId: workshop.id
		});
		const toolbox = await r.locations.create({
			name: 'Toolbox',
			code: 'WS-TB',
			parentId: workshop.id
		});

		// ---- Items ----
		const res10k = await r.items.create({
			categoryId: resistors.id,
			name: '10kΩ 1% 0603',
			qtyOnHand: 450,
			qtyMin: 100,
			locationId: binA1.id,
			attributes: { resistance: 10_000, tolerance: '1%', package: '0603', power_w: 0.1 }
		});
		await r.items.create({
			categoryId: resistors.id,
			name: '4.7kΩ 1% 0603',
			qtyOnHand: 80,
			qtyMin: 100,
			locationId: binA1.id,
			attributes: { resistance: 4_700, tolerance: '1%', package: '0603', power_w: 0.1 }
		});
		const res220 = await r.items.create({
			categoryId: resistors.id,
			name: '220Ω 5% THT',
			qtyOnHand: 200,
			locationId: binA1.id,
			attributes: { resistance: 220, tolerance: '5%', package: 'THT', power_w: 0.25 }
		});
		const cap100n = await r.items.create({
			categoryId: capacitors.id,
			name: '100nF 50V X7R 0805',
			qtyOnHand: 300,
			qtyMin: 50,
			locationId: binA2.id,
			attributes: { capacitance: 100e-9, voltage_v: 50, dielectric: 'X7R', package: '0805' }
		});
		await r.items.create({
			categoryId: capacitors.id,
			name: '470µF 25V electrolytic',
			qtyOnHand: 12,
			qtyMin: 5,
			locationId: binA2.id,
			attributes: { capacitance: 470e-6, voltage_v: 25, dielectric: 'Electrolytic', package: 'THT' }
		});
		const lm317 = await r.items.create({
			categoryId: ics.id,
			name: 'LM317 adjustable regulator',
			qtyOnHand: 6,
			qtyMin: 2,
			locationId: binA3.id,
			barcode: '0123456789012',
			attributes: {
				manufacturer: 'Texas Instruments',
				mpn: 'LM317T',
				function: 'Adjustable linear regulator',
				ic_package: 'TO-220',
				pins: 3
			}
		});
		const wireRed = await r.items.create({
			categoryId: wire.id,
			name: 'Hookup wire 22AWG red',
			qtyOnHand: 37_500, // 37.5 m
			qtyMin: 5_000,
			locationId: rack.id,
			attributes: { gauge_awg: 22, color: 'red', stranded: true, insulation: 'PVC' }
		});
		await r.items.create({
			categoryId: wire.id,
			name: 'Hookup wire 22AWG black',
			qtyOnHand: 4_200, // 4.2 m (below minimum)
			qtyMin: 5_000,
			locationId: rack.id,
			attributes: { gauge_awg: 22, color: 'black', stranded: true, insulation: 'PVC' }
		});
		await r.items.create({
			categoryId: wire.id,
			name: 'Silicone wire 18AWG black',
			qtyOnHand: 10_000,
			locationId: rack.id,
			attributes: { gauge_awg: 18, color: 'black', stranded: true, insulation: 'Silicone' }
		});
		await r.items.create({
			categoryId: tools.id,
			name: 'Wire stripper',
			qtyOnHand: 1,
			locationId: toolbox.id,
			attributes: { brand: 'Knipex', model: '12 62 180', tags: ['cutting', 'crimping'] }
		});
		await r.items.create({
			categoryId: tools.id,
			name: 'Soldering station',
			qtyOnHand: 1,
			locationId: toolbox.id,
			attributes: {
				brand: 'Pinecil',
				model: 'V2',
				tags: ['soldering'],
				purchase_date: '2025-03-14'
			}
		});

		// ---- Project with reservations and some history ----
		const psu = await r.projects.create({
			name: 'Bench power supply',
			description: 'LM317-based adjustable 1.25–20 V supply',
			status: 'active'
		});
		await r.reservations.reserve({ projectId: psu.id, sku: lm317.sku, qty: 1 });
		await r.reservations.reserve({ projectId: psu.id, sku: res220.sku, qty: 2 });
		await r.reservations.reserve({ projectId: psu.id, sku: cap100n.sku, qty: 4 });
		await r.reservations.reserve({ projectId: psu.id, sku: wireRed.sku, qty: 1_500 });

		await r.stock.adjust({ sku: res10k.sku, delta: -20, reason: 'consume', note: 'Misc. repairs' });
		await r.stock.count({ sku: cap100n.sku, countedQty: 298, note: 'Stocktake' });
	});

	return true;
}
