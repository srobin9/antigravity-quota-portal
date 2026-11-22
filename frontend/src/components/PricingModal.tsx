import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PriceCheckIcon from '@mui/icons-material/PriceCheck';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { resetPricing } from '../services/api';
import { ModelPricing } from '../types';

interface PricingModalProps {
  pricing: Record<string, ModelPricing>;
  defaultModelKeys?: string[];
  unmatchedModels?: string[];
  initialModelToAdd?: string | null;
  open: boolean;
  onClose: () => void;
  onSave: (matrix: Record<string, ModelPricing>, alreadyPersisted?: boolean) => Promise<void>;
  onError?: (msg: string) => void;
}

interface NewModelDraft {
  key: string;
  display_name: string;
  log_pattern: string;
  input_price_per_million: string;
  output_price_per_million: string;
  cached_price_per_million: string;
  estimated_input_ratio: string;
  estimated_output_ratio: string;
  estimated_cached_ratio: string;
  enable_gt_200k: boolean;
  input_price_gt_threshold_per_million: string;
  output_price_gt_threshold_per_million: string;
  cached_price_gt_threshold_per_million: string;
}

const EMPTY_DRAFT: NewModelDraft = {
  key: '',
  display_name: '',
  log_pattern: '',
  input_price_per_million: '2.00',
  output_price_per_million: '10.00',
  cached_price_per_million: '0.10',
  estimated_input_ratio: '0.70',
  estimated_output_ratio: '0.20',
  estimated_cached_ratio: '0.10',
  enable_gt_200k: false,
  input_price_gt_threshold_per_million: '',
  output_price_gt_threshold_per_million: '',
  cached_price_gt_threshold_per_million: '',
};

function slugifyModelKey(raw: string): string {
  const shortName = raw.trim().split('/').pop() || raw.trim();
  return shortName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prettifyModelName(raw: string): string {
  const shortName = (raw.trim().split('/').pop() || raw.trim()).replace(/[_-]+/g, ' ');
  return shortName.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Client-side mirror of match_model_pricing_with_meta for live preview in modal. */
function isModelMatchedInMatrix(modelName: string, matrix: Record<string, ModelPricing>): boolean {
  const full = (modelName || '').toLowerCase().trim();
  const shortName = full.includes('/') ? full.slice(full.lastIndexOf('/') + 1) : full;
  if (!full || full === 'default_fallback' || shortName === 'default_fallback') {
    return false;
  }

  const entries = Object.entries(matrix).filter(([k]) => k.toLowerCase() !== 'default_fallback');
  for (const [key] of entries) {
    const lk = key.toLowerCase();
    if (lk === full || lk === shortName) return true;
  }

  const candidates = shortName === full ? [shortName] : [shortName, full];
  for (const candidate of candidates) {
    for (const [, cfg] of entries) {
      const pattern = (cfg.log_pattern || '').toLowerCase().trim();
      if (!pattern) continue;
      const likeRegex = new RegExp('^' + pattern.split('%').map(escapeRegex).join('.*') + '$');
      if (likeRegex.test(candidate)) return true;

      const globRegex = new RegExp(
        '^' + pattern.replace(/%/g, '*').split('*').map(escapeRegex).join('.*') + '$'
      );
      if (globRegex.test(candidate)) return true;

      const minorRegex = new RegExp(
        '^' +
          pattern
            .split('%')
            .map((part) => escapeRegex(part).replace(/(\d+)-/g, '$1(?:\\.[0-9]+)?-'))
            .join('.*') +
          '$'
      );
      if (minorRegex.test(candidate)) return true;
    }
  }
  return false;
}

export const PricingModal: React.FC<PricingModalProps> = ({
  pricing,
  defaultModelKeys = [],
  unmatchedModels = [],
  initialModelToAdd = null,
  open,
  onClose,
  onSave,
  onError,
}) => {
  const [matrix, setMatrix] = useState<Record<string, ModelPricing>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<NewModelDraft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [patternManuallyEdited, setPatternManuallyEdited] = useState(false);
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);
  const prevOpenRef = useRef(false);

  const defaultKeysLower = useMemo(() => {
    const set = new Set(defaultModelKeys.map((k) => k.toLowerCase()));
    set.add('default_fallback');
    return set;
  }, [defaultModelKeys]);

  const buildPrefilledDraft = (modelName: string): NewModelDraft => {
    const key = slugifyModelKey(modelName);
    return {
      ...EMPTY_DRAFT,
      key,
      display_name: prettifyModelName(modelName),
      log_pattern: key ? `%${key}%` : '',
    };
  };

  useEffect(() => {
    if (open && !prevOpenRef.current && pricing) {
      setMatrix(JSON.parse(JSON.stringify(pricing)));
      setErrorMsg(null);
      setDraftError(null);
      if (initialModelToAdd) {
        setDraft(buildPrefilledDraft(initialModelToAdd));
        setShowAddForm(true);
        setKeyManuallyEdited(true);
        setPatternManuallyEdited(false);
      } else {
        setDraft(EMPTY_DRAFT);
        setShowAddForm(false);
        setKeyManuallyEdited(false);
        setPatternManuallyEdited(false);
      }
    }
    prevOpenRef.current = open;
  }, [pricing, open, initialModelToAdd]);

  const remainingUnmatched = useMemo(
    () => unmatchedModels.filter((m) => !isModelMatchedInMatrix(m, matrix)),
    [unmatchedModels, matrix]
  );

  const handlePriceChange = (
    modelKey: string,
    field: 'input_price_per_million' | 'output_price_per_million' | 'cached_price_per_million',
    value: string
  ) => {
    const num = Math.max(0, parseFloat(value) || 0);
    setMatrix((prev) => ({
      ...prev,
      [modelKey]: {
        ...prev[modelKey],
        [field]: num,
      },
    }));
  };

  const handleStringChange = (
    modelKey: string,
    field: 'display_name' | 'log_pattern',
    value: string
  ) => {
    setMatrix((prev) => ({
      ...prev,
      [modelKey]: {
        ...prev[modelKey],
        [field]: value,
      },
    }));
  };

  const handleRemoveCustomModel = (modelKey: string) => {
    setMatrix((prev) => {
      const next = { ...prev };
      delete next[modelKey];
      return next;
    });
  };

  const openAddFormForModel = (modelName?: string) => {
    setDraftError(null);
    if (modelName) {
      setDraft(buildPrefilledDraft(modelName));
      setKeyManuallyEdited(true);
      setPatternManuallyEdited(false);
    } else {
      setDraft(EMPTY_DRAFT);
      setKeyManuallyEdited(false);
      setPatternManuallyEdited(false);
    }
    setShowAddForm(true);
  };

  const handleAddDraftModel = () => {
    setDraftError(null);
    const cleanKey = draft.key.trim();
    const cleanDisplay = draft.display_name.trim();
    const cleanPattern = draft.log_pattern.trim();

    if (!cleanKey) {
      setDraftError('Model Key is required (e.g., gemini-4-xenon).');
      return;
    }
    if (cleanKey.toLowerCase() === 'default_fallback') {
      setDraftError('Cannot create a custom model named "default_fallback".');
      return;
    }
    if (Object.keys(matrix).some((k) => k.toLowerCase() === cleanKey.toLowerCase())) {
      setDraftError(`Model key "${cleanKey}" already exists in the Pricing Matrix.`);
      return;
    }
    if (!cleanDisplay) {
      setDraftError('Display Name is required.');
      return;
    }
    if (!cleanPattern) {
      setDraftError('Log Pattern is required (e.g., %4-xenon%).');
      return;
    }

    const pIn = parseFloat(draft.input_price_per_million);
    const pOut = parseFloat(draft.output_price_per_million);
    const pCache = parseFloat(draft.cached_price_per_million);
    const rIn = parseFloat(draft.estimated_input_ratio);
    const rOut = parseFloat(draft.estimated_output_ratio);
    const rCache = parseFloat(draft.estimated_cached_ratio);

    if ([pIn, pOut, pCache].some((v) => Number.isNaN(v) || v < 0)) {
      setDraftError('Input, Output, and Cached prices must be non-negative numbers.');
      return;
    }
    if ([rIn, rOut, rCache].some((v) => Number.isNaN(v) || v < 0 || v > 1)) {
      setDraftError('Hinge ratios must be between 0.0 and 1.0.');
      return;
    }

    const newEntry: ModelPricing = {
      display_name: cleanDisplay,
      log_pattern: cleanPattern,
      input_price_per_million: pIn,
      output_price_per_million: pOut,
      cached_price_per_million: pCache,
      estimated_input_ratio: rIn,
      estimated_output_ratio: rOut,
      estimated_cached_ratio: rCache,
    };

    if (draft.enable_gt_200k) {
      const gtIn = parseFloat(draft.input_price_gt_threshold_per_million);
      const gtOut = parseFloat(draft.output_price_gt_threshold_per_million);
      const gtCache = parseFloat(draft.cached_price_gt_threshold_per_million);
      if ([gtIn, gtOut, gtCache].some((v) => Number.isNaN(v) || v < 0)) {
        setDraftError('>200K context tier prices must be valid non-negative numbers.');
        return;
      }
      newEntry.context_tier_threshold_tokens = 200000;
      newEntry.input_price_gt_threshold_per_million = gtIn;
      newEntry.output_price_gt_threshold_per_million = gtOut;
      newEntry.cached_price_gt_threshold_per_million = gtCache;
    }

    // Insert new custom model at the top of the table for immediate visibility
    setMatrix((prev) => ({
      [cleanKey]: newEntry,
      ...prev,
    }));
    setDraft(EMPTY_DRAFT);
    setShowAddForm(false);
    setKeyManuallyEdited(false);
    setPatternManuallyEdited(false);
  };

  const calculateBlended = (p: ModelPricing) => {
    const rate =
      p.estimated_input_ratio * p.input_price_per_million +
      p.estimated_output_ratio * p.output_price_per_million +
      p.estimated_cached_ratio * p.cached_price_per_million;
    return rate.toFixed(4);
  };

  const draftBlendedPreview = useMemo(() => {
    const pIn = Math.max(0, parseFloat(draft.input_price_per_million) || 0);
    const pOut = Math.max(0, parseFloat(draft.output_price_per_million) || 0);
    const pCache = Math.max(0, parseFloat(draft.cached_price_per_million) || 0);
    const rIn = Math.max(0, parseFloat(draft.estimated_input_ratio) || 0);
    const rOut = Math.max(0, parseFloat(draft.estimated_output_ratio) || 0);
    const rCache = Math.max(0, parseFloat(draft.estimated_cached_ratio) || 0);
    return (rIn * pIn + rOut * pOut + rCache * pCache).toFixed(4);
  }, [draft]);

  const handleResetDefaults = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const fresh = await resetPricing();
      setMatrix(fresh);
      await onSave(fresh, true);
    } catch (e: any) {
      const msg = e?.message || 'Failed to reload default pricing matrix';
      setErrorMsg(msg);
      if (onError) onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    // Validate any edited custom model fields before submitting
    for (const [key, model] of Object.entries(matrix)) {
      if (!model.display_name?.trim() || !model.log_pattern?.trim()) {
        setErrorMsg(`Model "${key}" must have a non-empty display name and log pattern.`);
        return;
      }
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave(matrix);
      onClose();
    } catch (e: any) {
      const msg = e?.message || 'Failed to save pricing matrix';
      setErrorMsg(msg);
      if (onError) onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PriceCheckIcon sx={{ color: '#1a73e8' }} />
          Token Pricing &amp; Hinge Point Matrix
        </Box>
        <Button
          variant={showAddForm ? 'outlined' : 'contained'}
          size="small"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => (showAddForm ? setShowAddForm(false) : openAddFormForModel())}
          disabled={saving}
        >
          {showAddForm ? 'Hide Add Form' : 'Add Model'}
        </Button>
      </DialogTitle>
      <DialogContent dividers>
        {errorMsg && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg(null)}>
            {errorMsg}
          </Alert>
        )}

        {remainingUnmatched.length > 0 && (
          <Alert
            severity="warning"
            icon={<WarningAmberOutlinedIcon />}
            sx={{ mb: 2, border: '1px solid #f9ab00' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              Unrecognized model(s) currently using Default Fallback pricing:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {remainingUnmatched.map((modelName) => (
                <Chip
                  key={modelName}
                  size="small"
                  icon={<AddCircleOutlineIcon />}
                  label={`Add "${modelName}"`}
                  onClick={() => openAddFormForModel(modelName)}
                  sx={{
                    bgcolor: '#fff8e1',
                    border: '1px solid #f9ab00',
                    color: '#7c4a03',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    '&:hover': { bgcolor: '#ffecb3' },
                  }}
                />
              ))}
            </Box>
          </Alert>
        )}

        {/* Collapsible Add Custom Model Panel */}
        <Collapse in={showAddForm}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              mb: 2.5,
              border: '1px solid #1a73e8',
              borderRadius: 1.5,
              bgcolor: '#f8fbff',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1a73e8' }}>
                Add Custom Model Pricing Entry
              </Typography>
              <Typography variant="caption" sx={{ color: '#5f6368', fontWeight: 600 }}>
                Estimated Blended Rate: <strong>${draftBlendedPreview} / 1M</strong>
              </Typography>
            </Box>

            {draftError && (
              <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setDraftError(null)}>
                {draftError}
              </Alert>
            )}

            <Grid container spacing={1.5}>
              <Grid item xs={12} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Display Name"
                  placeholder="e.g., Gemini 4 Xenon"
                  value={draft.display_name}
                  onChange={(e) => {
                    const val = e.target.value;
                    const autoKey = slugifyModelKey(val);
                    setDraft((prev) => ({
                      ...prev,
                      display_name: val,
                      key: keyManuallyEdited ? prev.key : autoKey,
                      log_pattern:
                        patternManuallyEdited || keyManuallyEdited
                          ? prev.log_pattern
                          : autoKey
                          ? `%${autoKey}%`
                          : '',
                    }));
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Model Key (ID)"
                  placeholder="e.g., gemini-4-xenon"
                  value={draft.key}
                  onChange={(e) => {
                    const val = e.target.value;
                    setKeyManuallyEdited(true);
                    setDraft((prev) => ({
                      ...prev,
                      key: val,
                      log_pattern: patternManuallyEdited
                        ? prev.log_pattern
                        : val.trim()
                        ? `%${val.trim()}%`
                        : '',
                    }));
                  }}
                  inputProps={{ style: { fontFamily: 'monospace' } }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Log Match Pattern (SQL LIKE %)"
                  placeholder="e.g., %4-xenon%"
                  value={draft.log_pattern}
                  onChange={(e) => {
                    setPatternManuallyEdited(true);
                    setDraft((prev) => ({ ...prev, log_pattern: e.target.value }));
                  }}
                  inputProps={{ style: { fontFamily: 'monospace' } }}
                />
              </Grid>

              <Grid item xs={6} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Input / 1M ($)"
                  value={draft.input_price_per_million}
                  onChange={(e) => setDraft((prev) => ({ ...prev, input_price_per_million: e.target.value }))}
                  inputProps={{ step: 0.05, min: 0 }}
                />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Output / 1M ($)"
                  value={draft.output_price_per_million}
                  onChange={(e) => setDraft((prev) => ({ ...prev, output_price_per_million: e.target.value }))}
                  inputProps={{ step: 0.05, min: 0 }}
                />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Cached / 1M ($)"
                  value={draft.cached_price_per_million}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cached_price_per_million: e.target.value }))}
                  inputProps={{ step: 0.005, min: 0 }}
                />
              </Grid>
              <Grid item xs={4} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="In Ratio"
                  value={draft.estimated_input_ratio}
                  onChange={(e) => setDraft((prev) => ({ ...prev, estimated_input_ratio: e.target.value }))}
                  inputProps={{ step: 0.05, min: 0, max: 1 }}
                />
              </Grid>
              <Grid item xs={4} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Out Ratio"
                  value={draft.estimated_output_ratio}
                  onChange={(e) => setDraft((prev) => ({ ...prev, estimated_output_ratio: e.target.value }))}
                  inputProps={{ step: 0.05, min: 0, max: 1 }}
                />
              </Grid>
              <Grid item xs={4} sm={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Cache Ratio"
                  value={draft.estimated_cached_ratio}
                  onChange={(e) => setDraft((prev) => ({ ...prev, estimated_cached_ratio: e.target.value }))}
                  inputProps={{ step: 0.05, min: 0, max: 1 }}
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={draft.enable_gt_200k}
                    onChange={(e) => setDraft((prev) => ({ ...prev, enable_gt_200k: e.target.checked }))}
                  />
                }
                label={
                  <Typography variant="caption" sx={{ color: '#3c4043', fontWeight: 500 }}>
                    Enable &gt;200K long-context tier rates
                  </Typography>
                }
              />

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  onClick={() => {
                    setShowAddForm(false);
                    setDraftError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AddCircleOutlineIcon />}
                  onClick={handleAddDraftModel}
                >
                  Add to Matrix
                </Button>
              </Box>
            </Box>

            <Collapse in={draft.enable_gt_200k}>
              <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                <Grid item xs={4}>
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    label="Input >200K / 1M ($)"
                    value={draft.input_price_gt_threshold_per_million}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, input_price_gt_threshold_per_million: e.target.value }))
                    }
                    inputProps={{ step: 0.05, min: 0 }}
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    label="Output >200K / 1M ($)"
                    value={draft.output_price_gt_threshold_per_million}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, output_price_gt_threshold_per_million: e.target.value }))
                    }
                    inputProps={{ step: 0.05, min: 0 }}
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    label="Cached >200K / 1M ($)"
                    value={draft.cached_price_gt_threshold_per_million}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, cached_price_gt_threshold_per_million: e.target.value }))
                    }
                    inputProps={{ step: 0.005, min: 0 }}
                  />
                </Grid>
              </Grid>
            </Collapse>
          </Paper>
        </Collapse>

        <Typography variant="body2" sx={{ color: '#5f6368', mb: 2 }}>
          Configure per-million token rates (seeded from <code>config/model_pricing.json</code>) and fallback hinge ratios used to compute gross spend from Cloud Logging audit events. Saving immediately recalculates active cycle spend across all developers.
        </Typography>

        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #dadce0' }}>
          <Table size="small">
            <TableHead sx={{ backgroundColor: '#f1f3f4' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Model Name</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600 }}>Input / 1M ($)</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600 }}>Output / 1M ($)</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600 }}>Cached / 1M ($)</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600 }}>Hinge Ratios (In/Out/Cache)</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Blended / 1M</TableCell>
                <TableCell align="center" sx={{ fontWeight: 600, width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(matrix).map(([key, model]) => {
                const isCustom = !defaultKeysLower.has(key.toLowerCase());
                return (
                  <TableRow key={key} sx={isCustom ? { backgroundColor: '#fafcff' } : undefined}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {model.display_name}
                        </Typography>
                        {isCustom && (
                          <Chip
                            label="Custom"
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: 10,
                              fontWeight: 700,
                              bgcolor: '#e8f0fe',
                              color: '#1a73e8',
                            }}
                          />
                        )}
                      </Box>
                      {isCustom ? (
                        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography variant="caption" sx={{ color: '#5f6368' }}>
                            Pattern:
                          </Typography>
                          <TextField
                            size="small"
                            variant="standard"
                            value={model.log_pattern}
                            onChange={(e) => handleStringChange(key, 'log_pattern', e.target.value)}
                            sx={{ width: 150 }}
                            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                          />
                        </Box>
                      ) : (
                        <Typography variant="caption" sx={{ color: '#5f6368', fontFamily: 'monospace', display: 'block' }}>
                          Pattern: {model.log_pattern}
                        </Typography>
                      )}
                      {model.input_price_gt_threshold_per_million != null && (
                        <Typography variant="caption" sx={{ color: '#1a73e8', fontWeight: 500, display: 'block' }}>
                          &gt;200K tier: ${model.input_price_gt_threshold_per_million} in / ${model.output_price_gt_threshold_per_million} out / ${model.cached_price_gt_threshold_per_million} cache
                        </Typography>
                      )}
                    </TableCell>

                    <TableCell align="center">
                      <TextField
                        size="small"
                        type="number"
                        value={model.input_price_per_million}
                        onChange={(e) => handlePriceChange(key, 'input_price_per_million', e.target.value)}
                        sx={{ width: 85 }}
                        inputProps={{ step: 0.01, min: 0 }}
                      />
                    </TableCell>

                    <TableCell align="center">
                      <TextField
                        size="small"
                        type="number"
                        value={model.output_price_per_million}
                        onChange={(e) => handlePriceChange(key, 'output_price_per_million', e.target.value)}
                        sx={{ width: 85 }}
                        inputProps={{ step: 0.01, min: 0 }}
                      />
                    </TableCell>

                    <TableCell align="center">
                      <TextField
                        size="small"
                        type="number"
                        value={model.cached_price_per_million}
                        onChange={(e) => handlePriceChange(key, 'cached_price_per_million', e.target.value)}
                        sx={{ width: 85 }}
                        inputProps={{ step: 0.005, min: 0 }}
                      />
                    </TableCell>

                    <TableCell align="center">
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {(model.estimated_input_ratio * 100).toFixed(0)}% / {(model.estimated_output_ratio * 100).toFixed(0)}% / {(model.estimated_cached_ratio * 100).toFixed(0)}%
                      </Typography>
                    </TableCell>

                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#1a73e8' }}>
                        ${calculateBlended(model)}
                      </Typography>
                    </TableCell>

                    <TableCell align="center">
                      {isCustom && (
                        <Tooltip title="Remove custom model (applied on Save)">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveCustomModel(key)}
                            disabled={saving}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button color="secondary" onClick={handleResetDefaults} disabled={saving}>
          Reload Config Defaults
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Pricing Matrix'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
