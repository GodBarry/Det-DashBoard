export function TrainingLogPanel({ logs }) {

return (

<section className="log-panel">

<h2>训练日志</h2>

<div className="log-box">

{logs.map((log) => <p key={log.id}><span>{log.stream}</span>{log.line}</p>)}

{!logs.length && <div className="muted">选择一个训练任务后查看日志</div>}

</div>

</section>

);

}
