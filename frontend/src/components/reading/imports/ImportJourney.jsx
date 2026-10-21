const stages = ["Choose file", "Review", "Import", "Results"];
const stageFor = phase => ({ uploading: 0, analyzing: 1, grouping: 1, preview_ready: 1, applying: 2, completed: 3, completed_with_issues: 3, cancelled: 3, expired: 3, failed: 1 })[phase] ?? 0;

export default function ImportJourney({ run }) {
  const current = stageFor(run?.phase);
  return <ol className="bv-import-journey" aria-label="Library import stages">
    {stages.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined}>
      <span aria-hidden="true">{index + 1}</span><span>{label}</span>
    </li>)}
  </ol>;
}
