import QuizChoice from './QuizChoice'

// question: { question, choices: string[], answer: number }
// onAnswer(selectedIndex): called when a choice is picked
// answered: bool — locks choices after selection
// selectedIndex: which was chosen
export default function QuizQuestion({ question, choices, onAnswer, answered, selectedIndex }) {
  const getState = (i) => {
    if (!answered) return null
    if (i === selectedIndex) return 'selected'
    return null
  }

  return (
    <div className="bg-surface rounded-card shadow-card p-6 mb-4">
      <h3 className="text-lg font-semibold mb-4">{question}</h3>
      {choices.map((c, i) => (
        <QuizChoice
          key={i}
          text={c}
          state={getState(i)}
          onClick={() => !answered && onAnswer(i)}
          disabled={answered}
        />
      ))}
    </div>
  )
}
