// state: null | 'selected' | 'correct' | 'wrong'
export default function QuizChoice({ text, state, onClick, disabled }) {
  let cls = 'quiz-choice'
  if (state) cls += ` ${state}`

  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {text}
    </button>
  )
}
