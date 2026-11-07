import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

// Radix takes no empty value: this one stands for no filter.
const ANY = '\u0000any'

// A filter with too many values for chips, styled like the session switch.
export function Choice({ label, value, options, anyText, onChange, testId }: { label: string; value: string | null; options: readonly (readonly [string, string])[]; anyText: string; onChange: (value: string | null) => void; testId: string }) {
  const text = value === null ? anyText : (options.find(([key]) => key === value)?.[1] ?? value)
  return (
    <Select.Root value={value ?? ANY} onValueChange={v => onChange(v === ANY ? null : v)}>
      <Select.Trigger className="select-trigger !h-[26px] max-w-56" aria-label={`${label}: ${text}`} data-testid={testId}>
        <span className="min-w-0 flex-1 truncate text-left"><Select.Value>{text}</Select.Value></span>
        <Select.Icon><ChevronDown size={14} className="flex-none text-ink-3" aria-hidden /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-menu" position="popper" sideOffset={4}>
          <Select.Viewport>
            {[[ANY, anyText] as const, ...options].map(([key, name]) => (
              <Select.Item key={key} value={key} className="select-item">
                <Select.ItemIndicator className="select-check"><Check size={14} aria-hidden /></Select.ItemIndicator>
                <Select.ItemText>{name}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
