/** Placeholder blocks in the shape of the page, shown while the run loads, so nothing jumps when it arrives. */
const Bone = ({ w, h, round = false }: { w: string; h: number; round?: boolean }) => (
  <span className={`bone${round ? ' round' : ''}`} style={{ width: w, height: h }} />
);

export type SkeletonShape = 'overview' | 'table' | 'timeline';

export function Skeleton({ shape }: { shape: SkeletonShape }) {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading the run">
      {shape === 'overview' && (
        <>
          <div className="card skel-row">
            <div className="skel-col">
              <Bone w="260px" h={30} />
              <Bone w="340px" h={14} />
            </div>
            <div className="skel-tiles">
              {Array.from({ length: 6 }, (_, i) => (
                <Bone key={i} w="100%" h={44} />
              ))}
            </div>
          </div>
          <div className="problems">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="card skel-col">
                <Bone w="70%" h={22} />
                <div className="skel-story">
                  <Bone w="44px" h={44} round />
                  <Bone w="44px" h={44} round />
                  <Bone w="44px" h={44} round />
                </div>
                <Bone w="90%" h={14} />
                <Bone w="60%" h={14} />
                <Bone w="120px" h={34} />
              </div>
            ))}
          </div>
        </>
      )}
      {shape === 'table' && (
        <div className="card skel-col">
          <Bone w="200px" h={22} />
          <Bone w="100%" h={36} />
          {Array.from({ length: 9 }, (_, i) => (
            <Bone key={i} w="100%" h={28} />
          ))}
        </div>
      )}
      {shape === 'timeline' && (
        <div className="card skel-col">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skel-lane">
              <Bone w="60px" h={16} />
              <Bone w="100%" h={8} />
            </div>
          ))}
        </div>
      )}
      <span className="sr-only">Loading the run…</span>
    </div>
  );
}
