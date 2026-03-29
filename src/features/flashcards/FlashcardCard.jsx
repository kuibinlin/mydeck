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
          <h2 className="text-3xl mb-2">{front}</h2>
          <p className="text-muted">Tap to flip</p>
        </div>

        {/* Back face */}
        <div className="flashcard-face flashcard-back">
          <h3 className="text-2xl text-primary mb-3">
            {meaning}
          </h3>
          {note && (
            <div className="mt-3 pt-3 border-t border-border text-muted text-sm text-center">
              {note}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
