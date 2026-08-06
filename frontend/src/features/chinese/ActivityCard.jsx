// Renders whatever activity the tutor built.
//
// Lazy on purpose: hanzi-writer is only downloaded once a learner actually asks
// to practise writing, so the main bundle is unchanged for everyone else.
//
// An error boundary per activity, not per page. A widget that throws should
// cost its own card, not the conversation around it.
import { lazy, Suspense, Component } from "react";

const StrokeSheet = lazy(() => import("./activities/StrokeSheet"));
const QuickCheck = lazy(() => import("./activities/QuickCheck"));

const WIDGETS = { stroke: StrokeSheet, match: QuickCheck };

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="rounded-card border border-border bg-surface px-4 py-3 text-sm text-muted">
          That practice card didn&rsquo;t load. Everything else here still works.
        </p>
      );
    }
    return this.props.children;
  }
}

const Placeholder = () => (
  <div className="rounded-card border border-border bg-surface h-44 animate-pulse" />
);

export default function ActivityCard({ activity, onComplete }) {
  const Widget = WIDGETS[activity?.type];
  // An unknown type is a newer server talking to an older client. Rendering
  // nothing is the right answer — the prose and cards still stand on their own.
  if (!Widget) return null;

  return (
    <Boundary>
      <Suspense fallback={<Placeholder />}>
        <Widget activity={activity} onComplete={onComplete} />
      </Suspense>
    </Boundary>
  );
}
