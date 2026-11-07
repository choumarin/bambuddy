import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, RotateCcw, Palette } from 'lucide-react';
import { getColorName } from '../../utils/colors';
import { canonicalFilamentType, normalizeColorForCompare } from '../../utils/amsHelpers';
import { SlotPicker } from './SlotPicker';
import { displayHex } from './displayHex';
import { useFilamentLabels } from './useFilamentLabels';
import { AS_SLICED_VALUE } from '../../hooks/useFilamentMapping';
import type { FilamentReqsData } from './types';

interface FilamentOverrideProps {
  filamentReqs: FilamentReqsData | undefined;
  availableFilaments: Array<{ type: string; color: string; tray_info_idx: string; tray_sub_brands: string; extruder_id: number | null }>;
  overrides: Record<number, { type: string; color: string }>;
  onChange: (overrides: Record<number, { type: string; color: string }>) => void;

  /** Per-slot force color match flags. Defaults to false (opt-in) when not provided. */
  forceColorMatch?: Record<number, boolean>;
  /** Called when a slot's force color match checkbox is toggled. */
  onForceColorMatchChange?: (slotId: number, value: boolean) => void;
  /** Called when the user picks the "As sliced" row for a slot (#3460). Lets
   *  the caller distinguish that pick from a plain force tick, which keeps
   *  its pre-existing colour-only matching. */
  onAsSlicedPick?: (slotId: number) => void;
  /** Names the plate these requirements belong to, when one panel is rendered per
   *  selected plate. Each plate prints its own subset of the file's slots (#2552). */
  plateLabel?: string;
  /** Whether to print the explanatory hint. A stack of per-plate panels only needs
   *  it once, above the first one. Defaults to true. */
  showHint?: boolean;
}

/**
 * Filament override UI for model-based queue assignment.
 * Allows users to override the 3MF's original filament choices with
 * filaments available across printers of the selected model.
 */
export function FilamentOverride({
  filamentReqs,
  availableFilaments,
  overrides,
  onChange,
  forceColorMatch,
  onForceColorMatchChange,
  onAsSlicedPick,
  plateLabel,
  showHint = true,
}: FilamentOverrideProps) {
  const { t } = useTranslation();

  // Per-slot sub-brand + material-disambiguated colour labels (#1718). The
  // shared hook fronts the three queries that power the resolution so this
  // component and ``FilamentMapping`` cannot drift apart on label content.
  const labels = useFilamentLabels(filamentReqs?.filaments);

  // Index available filaments by canonical type for per-slot filtering.
  // Types in the same equivalence group (e.g. PA-CF / PA12-CF / PAHT-CF) share one bucket.
  const filamentsByType = useMemo(() => {
    const map: Record<string, Array<{ type: string; color: string; tray_info_idx: string; tray_sub_brands: string; extruder_id: number | null }>> = {};
    for (const f of availableFilaments) {
      const key = canonicalFilamentType(f.type);
      if (!map[key]) map[key] = [];
      map[key].push(f);
    }
    return map;
  }, [availableFilaments]);

  const filaments = filamentReqs?.filaments;
  // #3460: an empty `availableFilaments` no longer hides the panel. Its rows
  // still carry the force-colour checkbox, which is the only way to ask for
  // "as sliced" when no printer of the model has anything loaded right now —
  // exactly the situation where the job should wait for the colours to be.
  if (!filaments || filaments.length === 0) {
    return null;
  }

  const handleChange = (slotId: number, value: string) => {
    if (value === AS_SLICED_VALUE) {
      // "As sliced" is the placeholder state itself: drop any override and arm
      // the force toggle so dispatch waits for the sliced colour (#3460).
      const next = { ...overrides };
      delete next[slotId];
      onChange(next);
      onForceColorMatchChange?.(slotId, true);
      onAsSlicedPick?.(slotId);
      return;
    }
    if (value === '') {
      // Reset to original
      const next = { ...overrides };
      delete next[slotId];
      onChange(next);
    } else {
      // Parse "TYPE|COLOR" value
      const [type, color] = value.split('|');
      onChange({ ...overrides, [slotId]: { type, color } });
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-sm text-bambu-gray mb-2">
        <span>
          {plateLabel
            ? `${t('printModal.filamentOverride')} — ${plateLabel}`
            : t('printModal.filamentOverride')}
        </span>
      </div>
      {showHint && <p className="text-xs text-bambu-gray mb-2">{t('printModal.filamentOverrideHint')}</p>}
      <div className="bg-bambu-dark rounded-lg p-3 space-y-2">
        {filaments.map((req, slotIdx) => {
          const override = overrides[req.slot_id];
          const isOverridden = !!override;
          // Only show filaments of the same type AND compatible nozzle/extruder
          const sameType = filamentsByType[canonicalFilamentType(req.type)] || [];
          // On dual-nozzle printers (H2D), filter to filaments on the correct extruder.
          // nozzle_id from 3MF maps to extruder_id from AMS. If nozzle_id is undefined
          // (single-nozzle) or extruder_id is null, no nozzle filtering is needed.
          const compatible = req.nozzle_id != null
            ? sameType.filter((f) => f.extruder_id == null || f.extruder_id === req.nozzle_id)
            : sameType;

          // #1718: sub-brand resolved from the 3MF's tray_info_idx via the
          // builtin / cloud-id maps, plus the material-disambiguated catalogue
          // colour for the hex. Both fall back gracefully (resolvedName →
          // req.type when the SKU is unknown; colorLabel → getColorName(hex)
          // when the by-material lookup hasn't resolved yet, returned null,
          // or errored) so a slow query never blanks out the row.
          const { resolvedName, colorLabel } = labels[slotIdx] ?? { resolvedName: req.type, colorLabel: getColorName(req.color) };

          return (
            <div key={req.slot_id} className="space-y-1">
              {/* Below `sm` the picker gets a line of its own, as on the
                  mapping row (#3294). */}
              <div className="grid items-center gap-2 text-xs grid-cols-[16px_minmax(0,1fr)_20px] sm:grid-cols-[16px_minmax(70px,1fr)_auto_2fr_20px]">
                {/* Original color swatch */}
                <span title={`${t('printModal.originalFilament')}: ${resolvedName} - ${colorLabel}`}>
                  <Circle className="w-3 h-3" fill={req.color} stroke={req.color} />
                </span>
                {/* Original type + grams */}
                <span className="text-white truncate col-span-2 sm:col-span-1">
                  {resolvedName} <span className="text-bambu-gray">({req.used_grams}g)</span>
                </span>
                {/* Arrow */}
                <span className="text-bambu-gray">→</span>
                {/* Override picker — only compatible (same-type) filaments.
                    Carries a swatch for the same reason the mapping row does
                    (#3159): this is the model-mode half of the same choice,
                    and leaving it text-only would make the two paths read
                    differently for one decision. Model mode pools filaments
                    across every printer of the model, so there is no slot
                    binding behind an entry and the swatch is the plain tray
                    colour -- solid, with no multi-colour stops to draw. */}
                <SlotPicker
                  value={isOverridden ? `${override.type}|${override.color}` : ''}
                  onChange={(next) => handleChange(req.slot_id, next)}
                  // When force is armed and no override is set, this slot IS the
                  // "as sliced" pick — say so instead of the generic original
                  // label (#3460).
                  placeholder={
                    (forceColorMatch?.[req.slot_id] ?? false) && !isOverridden
                      ? t('printModal.asSliced', { name: resolvedName, color: colorLabel })
                      : `${t('printModal.originalFilament')}: ${resolvedName} (${colorLabel})`
                  }
                  placeholderOption={{ rgba: req.color, hex: displayHex(req.color) }}
                  // The picker stays usable with nothing loaded anywhere on the
                  // model: the "As sliced" row needs no tray to be meaningful,
                  // and it is the point of the empty-AMS case (#3460). Only a
                  // panel with no force wiring at all has nothing left to
                  // offer.
                  disabled={compatible.length === 0 && !onForceColorMatchChange}
                  ariaLabel={t('printModal.overrideForFilament', { name: resolvedName })}
                  exactMatchLabel={t('printModal.exactColorMatch')}
                  className={
                    isOverridden
                      ? 'border-blue-500/50 dark:border-blue-400/50 text-blue-700 dark:text-blue-400'
                      : 'border-bambu-gray/30 text-bambu-gray'
                  }
                  options={[
                    // #3460: the sliced file's own colour, as an explicit pick.
                    // Selecting it clears any override and arms "Force color
                    // match", so dispatch waits until some printer of the model
                    // actually holds the colour. Only offered when the caller
                    // persists force flags — without one the pick could not say
                    // what it means — and hidden once the slot already IS the
                    // as-sliced pick (force armed, no override), where the
                    // placeholder row reads the same and a second row would
                    // look like a second choice.
                    ...(onForceColorMatchChange
                      && !((forceColorMatch?.[req.slot_id] ?? false) && !isOverridden)
                      ? [{
                          value: AS_SLICED_VALUE,
                          label: t('printModal.asSliced', { name: resolvedName, color: colorLabel }),
                          rgba: req.color,
                          exactMatch: true,
                        }]
                      : []),
                    ...compatible.map((f, idx) => ({
                    // The value has to stay `TYPE|COLOR` -- `handleChange`
                    // parses it -- but two spools of the same type and colour
                    // on different printers collapse to one value, so the key
                    // keeps the sub-brand and the index as it did before.
                    value: `${f.type}|${f.color}`,
                    key: `${f.type}-${f.color}-${f.tray_sub_brands}-${idx}`,
                    label: `${f.tray_sub_brands || f.type} (${getColorName(f.color, f.tray_sub_brands, f.tray_info_idx)})`,
                    rgba: f.color,
                    hex: displayHex(f.color),
                    exactMatch:
                      normalizeColorForCompare(req.color) !== '' &&
                      normalizeColorForCompare(f.color) === normalizeColorForCompare(req.color),
                  }))
                ]}
                />
                {/* Reset button */}
                {isOverridden ? (
                  <button
                    type="button"
                    onClick={() => handleChange(req.slot_id, '')}
                    className="text-bambu-gray hover:text-white transition-colors"
                    title={t('printModal.resetToOriginal')}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="w-3" />
                )}
              </div>
              {/* Force Color Match checkbox — shown below each filament row */}
              <label className="inline-flex items-center gap-1.5 text-xs text-bambu-gray cursor-pointer select-none pl-5">
                <input
                  type="checkbox"
                  checked={forceColorMatch?.[req.slot_id] ?? false}
                  onChange={(e) => onForceColorMatchChange?.(req.slot_id, e.target.checked)}
                  className="accent-bambu-green w-3 h-3"
                />
                <Palette className="w-3 h-3" />
                {t('printModal.forceColorMatch')}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
