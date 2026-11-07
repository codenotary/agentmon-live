// The button under a folded list: "Show all (n)" or "Show fewer". Each list keeps its own fold.
export function ShowAll({ isAll, count, onToggle, p }: { isAll: boolean; count?: number; onToggle: () => void; p: { listAll: string; listFewer: string } }) {
  return (
    <button type="button" className="chip mt-2" aria-expanded={isAll} onClick={onToggle}>
      {isAll ? p.listFewer : count === undefined ? p.listAll : `${p.listAll} (${count})`}
    </button>
  )
}
