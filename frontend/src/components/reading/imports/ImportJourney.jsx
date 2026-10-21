const stages = ["Choose file", "Check library", "Review", "Add books", "Results"];
const stageFor = phase => ({ uploading: 0, analyzing: 1, grouping: 1, preview_ready: 2, applying: 3, completed: 4, completed_with_issues: 4, cancelled: 4, expired: 4, failed: 1 })[phase] ?? 0;

export default function ImportJourney({ run }) {
  const current = stageFor(run?.phase);
  return <ol className="bv-import-journey" aria-label="Library import stages">
    {stages.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined}>
      <span aria-hidden="true">{index + 1}</span><span>{label}</span>
    </li>)}
  </ol>;
}
