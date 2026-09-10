/** 指法核心模块：模式表、profile、指法引擎 */
export {
  TRIAD_PATTERNS,
  SEVENTH_PATTERNS,
  basePatterns,
  type FingeringPattern,
  type Hand,
  type InversionPatterns,
} from './patterns'
export {
  STANDARD_PROFILE,
  SMALL_HAND_PROFILE,
  createCustomProfile,
  getBuiltinProfile,
  overrideKey,
  validateFingers,
  type FingeringOverrideKey,
  type FingeringProfile,
  type FingeringProfileId,
} from './profile'
export { getChordFingering, type ChordFingering, type ChordFingeringRequest } from './engine'
