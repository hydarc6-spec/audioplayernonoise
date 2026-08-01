/**
 * Controls.js
 * -----------
 * Renders the per-stage control cards (enable toggle + relevant sliders)
 * described in the spec: noise reduction strength, voice enhancement,
 * high-pass cutoff, notch mode, and an enable/disable switch for every
 * filter. Framework-free (plain DOM) to keep the whole project
 * dependency-light and trivially portable into any wrapper shell.
 *
 * Every control change calls `onChange(partialSettings)`, which the
 * caller (main.js) forwards straight to `AudioEngine.updateSettings`,
 * which posts it to the worklet -- so changes take effect on the very
 * next audio quantum (no debounce needed at this scale of message).
 */
export function renderControls(container, initialSettings, onChange) {
  container.innerHTML = '';

  container.appendChild(
    _card('DC Offset Removal', initialSettings.dcBlockerEnabled, (enabled) =>
      onChange({ dcBlockerEnabled: enabled })
    )
  );

  container.appendChild(
    _card('High-Pass Filter', initialSettings.highPassEnabled, (enabled) =>
      onChange({ highPassEnabled: enabled }),
      [
        _slider('Cutoff (Hz)', 20, 250, initialSettings.highPassCutoffHz, 1, (v) =>
          onChange({ highPassCutoffHz: v })
        ),
      ]
    )
  );

  container.appendChild(
    _card('Adaptive Notch (Mains Hum)', initialSettings.notchEnabled, (enabled) =>
      onChange({ notchEnabled: enabled }),
      [
        _select('Frequency', ['Auto', '50 Hz', '60 Hz'], ['auto', 50, 60],
          initialSettings.notchMode, (v) => onChange({ notchMode: v })
        ),
      ]
    )
  );

  container.appendChild(
    _card('Spectral Noise Suppression', initialSettings.noiseSuppressionEnabled, (enabled) =>
      onChange({ noiseSuppressionEnabled: enabled }),
      [
        _slider('Strength', 0, 100, initialSettings.noiseReductionStrength, 1, (v) =>
          onChange({ noiseReductionStrength: v })
        ),
      ]
    )
  );

  container.appendChild(
    _card('Voice Enhancement (Wiener)', initialSettings.voiceEnhancementEnabled, (enabled) =>
      onChange({ voiceEnhancementEnabled: enabled }),
      [
        _slider('Amount', 0, 100, initialSettings.voiceEnhancement, 1, (v) =>
          onChange({ voiceEnhancement: v })
        ),
      ]
    )
  );

  container.appendChild(
    _card('Automatic Gain Control', initialSettings.agcEnabled, (enabled) =>
      onChange({ agcEnabled: enabled })
    )
  );

  container.appendChild(
    _card('Soft Limiter', initialSettings.limiterEnabled, (enabled) =>
      onChange({ limiterEnabled: enabled })
    )
  );
}

function _card(title, enabledInitial, onToggle, extraRows = []) {
  const card = document.createElement('div');
  card.className = 'control-card';

  const heading = document.createElement('h4');
  heading.textContent = title;

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'toggle';
  toggle.checked = enabledInitial;
  toggle.addEventListener('change', () => onToggle(toggle.checked));

  heading.appendChild(toggle);
  card.appendChild(heading);
  extraRows.forEach((row) => card.appendChild(row));
  return card;
}

function _slider(label, min, max, value, step, onInput) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = `${label}: ${value}`;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener('input', () => {
    lab.textContent = `${label}: ${input.value}`;
    onInput(Number(input.value));
  });

  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

function _select(label, optionLabels, optionValues, currentValue, onChange) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = label;

  const select = document.createElement('select');
  optionLabels.forEach((text, i) => {
    const opt = document.createElement('option');
    opt.value = optionValues[i];
    opt.textContent = text;
    if (optionValues[i] === currentValue) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    const raw = select.value;
    // Coerce numeric-looking values (50/60) back to numbers; 'auto' stays a string.
    onChange(raw === 'auto' ? raw : Number(raw));
  });

  wrap.appendChild(lab);
  wrap.appendChild(select);
  return wrap;
}
