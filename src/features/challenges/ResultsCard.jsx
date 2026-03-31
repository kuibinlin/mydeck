import { useNavigate } from 'react-router'

// Renders a single choice row in the breakdown
function ChoiceRow({ text, isCorrect, isUserWrong }) {
  const style = isCorrect
    ? 'border-success/60 bg-success/10 text-success font-medium'
    : isUserWrong
    ? 'border-error/60 bg-error/10 text-error'
    : 'border-border text-muted'

  const icon = isCorrect
    ? 'fa-check text-success'
    : isUserWrong
    ? 'fa-times text-error'
    : 'fa-circle text-border text-[7px]'

  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${style}`}>
      <i className={`fas ${icon} shrink-0 w-3 text-center`} />
      {text}
    </div>
  )
}

// Renders one question with all choices revealed
function QuestionReview({ card, userPick, questionNumber }) {
  const choices = card.choices
  const correct = card.answer
  const isCorrect = userPick === correct

  return (
    <div className="bg-surface rounded-card border border-border p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${isCorrect ? 'bg-success text-white' : 'bg-error text-white'}`}>
          <i className={`fas ${isCorrect ? 'fa-check' : 'fa-times'}`} />
        </span>
        <p className="text-sm font-semibold leading-snug">
          <span className="text-muted font-normal mr-1.5">Q{questionNumber}.</span>
          {card.question}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 pl-7">
        {choices.map((choice, j) => (
          <ChoiceRow
            key={j}
            text={choice}
            isCorrect={j === correct}
            isUserWrong={j === userPick && !isCorrect}
          />
        ))}
      </div>
    </div>
  )
}

export default function ResultsCard({ score, total, versionId, deckId, cards, selectedAnswers }) {
  const navigate = useNavigate()
  const pct = Math.round((score / total) * 100)
  const feedback = pct >= 80 ? 'Great job!' : pct >= 50 ? 'Good effort!' : 'Keep studying!'

  return (
    <div>
      {/* Score summary */}
      <div className="bg-surface rounded-card shadow-card p-8 text-center mb-6">
        <div className="text-5xl font-bold text-primary">{pct}%</div>
        <p className="text-lg my-2">{score} / {total} correct</p>
        <p className="text-muted mb-5">{feedback}</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-primary hover:bg-primary-hover text-white font-semibold rounded-btn transition-all cursor-pointer border border-transparent"
            onClick={() => navigate(`/challenges/${deckId}`)}
          >
            <i className="fas fa-redo" /> Try Again
          </button>
          {versionId && (
            <button
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm bg-transparent text-primary border border-primary hover:bg-primary hover:text-white font-semibold rounded-btn transition-all cursor-pointer"
              onClick={() => navigate(`/leaderboard/${versionId}`)}
            >
              <i className="fas fa-medal" /> Leaderboard
            </button>
          )}
        </div>
      </div>

      {/* Question breakdown */}
      {cards?.length > 0 && selectedAnswers?.length > 0 && (
        <div>
          <h3 className="text-base font-bold mb-3">Question Breakdown</h3>
          <div className="flex flex-col gap-3">
            {cards.map((card, i) => (
              <QuestionReview
                key={i}
                card={card}
                userPick={selectedAnswers[i]}
                questionNumber={i + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
