import { z } from 'zod';

/** Determines the integer base unit for stock quantities (plan §3.4). */
export const unitKindSchema = z.enum(['count', 'length', 'mass', 'volume']);
export type UnitKind = z.infer<typeof unitKindSchema>;

export const projectStatusSchema = z.enum(['planning', 'active', 'completed', 'cancelled']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const reservationStatusSchema = z.enum(['reserved', 'consumed', 'released']);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const movementReasonSchema = z.enum([
	'receive',
	'consume',
	'adjust',
	'count',
	'reserve_consume'
]);
export type MovementReason = z.infer<typeof movementReasonSchema>;
