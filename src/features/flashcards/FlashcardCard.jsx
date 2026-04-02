// The physical flashcard with 3D flip animation
// flipped: bool controlled by parent
// onClick: flip handler
import { cn } from '@/lib/cn'

export default function FlashcardCard({ front, meaning, note, flipped, onClick }) {
  return (
    <div className="flashcard-container">
      <div className={cn('flashcard', flipped && 'flipped')} onClick={onClick}>
        {/* Front face */}
        <div className="flashcard-face">
          <h2 className="text-3xl font-bold text-white text-center mb-3" style={{ whiteSpace: 'pre-line' }}>{front}</h2>
          <p className="text-sm text-white/60">Tap to flip</p>
        </div>

        {/* Back face */}
        <div className="flashcard-face flashcard-back">
          <h3 className="text-2xl font-semibold text-white text-center mb-3">
            {meaning}
          </h3>
          {note && (
            <div className="mt-2 pt-3 border-t border-white/25 text-white text-base text-center leading-relaxed">
              {note}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
