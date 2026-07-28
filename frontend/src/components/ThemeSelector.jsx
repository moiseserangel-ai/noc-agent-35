import { Monitor, Moon, Sun } from 'lucide-react';

const options = [
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'auto', label: 'Automático', Icon: Monitor },
];

export default function ThemeSelector({ value, onChange, compact = false }) {
  const selected = options.find(option => option.value === value) || options[0];
  return <label className={`theme-selector ${compact ? 'compact' : ''}`} title="Aparência">
    <selected.Icon size={15}/>
    <select value={value} onChange={event => onChange(event.target.value)} aria-label="Tema da interface">
      {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
