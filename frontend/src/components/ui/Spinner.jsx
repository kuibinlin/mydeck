// center: wraps in a centred flex container
export default function Spinner({ center }) {
  if (center) {
    return (
      <div className="flex justify-center p-10">
        <div className="spinner" />
      </div>
    )
  }
  return <div className="spinner" />
}
