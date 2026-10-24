import type { Feeling } from './storage';
import { METRICS, type HrvValues, type ExpressionValue, type Metric } from './signals';
import type { ReportSnapshot } from './report';
import { selectSuggestions } from './tips';
import './wellness.css';

const LABELS: Record<Metric, string> = {
  pulse: 'Pulse', breathingRate: 'Breathing rate', chestWave: 'Chest breathing waveform', abdomenWave: 'Abdomen breathing waveform',
  hrv: 'HRV', blink: 'Blink detection', talking: 'Talking detection', expression: 'Facial classification',
  edaProxy: 'EDA proxy', arterialWave: 'Relative arterial waveform',
};

export default function WellnessReport({ report, choice }: { report: ReportSnapshot; choice: Feeling | null }) {
  const pulse = report.metrics.pulse;
  const breathing = report.metrics.breathingRate;
  const hrv = report.metrics.hrv.latest as HrvValues | null;
  const expression = report.metrics.expression.latest as ExpressionValue | null;
  const simulated = report.source === 'simulated';
  return <section className="wellness-report" aria-label="Post-shift wellness report">
    <div className="wellness-checkin__label">POST-SHIFT WELLNESS REPORT</div>
    {simulated ? <p className="wellness-report__simulation">SIMULATED DEVELOPMENT FIXTURE · camera off · no real measurements</p>
      : <p>{report.source === 'presage' ? 'Camera observations from this shift only.' : 'Camera observations: unavailable this shift.'}</p>}
    <div className="wellness-report__summary">
      <p>{pulse.available && report.pulseBaselineBpm !== null && typeof pulse.latest === 'number'
        ? `Pulse: latest accepted ${Math.round(pulse.latest)} BPM; ${Math.round(pulse.latest - report.pulseBaselineBpm) >= 0 ? '+' : ''}${Math.round(pulse.latest - report.pulseBaselineBpm)} BPM relative to this shift’s ${Math.round(report.pulseBaselineBpm)} BPM baseline.`
        : 'Pulse relative to a session baseline: unavailable.'}</p>
      <p>{breathing.available && breathing.min !== null && breathing.max !== null
        ? `Breathing rate: ${Math.round(breathing.min)}–${Math.round(breathing.max)} breaths/min across accepted windows.`
        : 'Breathing pattern: unavailable.'}</p>
      <p>{report.metrics.hrv.available && hrv
        ? `HRV measurements: RMSSD ${Math.round(hrv.rmssd)} ms; SDNN ${Math.round(hrv.sdnn)} ms; mean NN ${Math.round(hrv.meanNn)} ms.`
        : 'HRV measurements: unavailable.'}</p>
      <p>{report.metrics.blink.available ? `${report.metrics.blink.events} blink event(s) observed.` : 'Blink events: unavailable.'} {' '}
        {report.metrics.talking.available ? `${report.metrics.talking.events} talking event(s) observed.` : 'Talking events: unavailable.'}</p>
      <p>{report.metrics.expression.available && expression
        ? `Facial classification: top model label “${expression.label}” (${Math.round(expression.score)}% score); this is not a report of how you felt.`
        : 'Facial classification: unavailable.'}</p>
      <p>{report.metrics.edaProxy.available ? 'EDA proxy trace: observed; no interpretation applied.' : 'EDA proxy trace: unavailable.'} {' '}
        {report.metrics.arterialWave.available ? 'Relative arterial waveform: observed; no blood pressure value.' : 'Relative arterial waveform: unavailable.'}</p>
      <p>{report.metrics.chestWave.available ? 'Chest breathing waveform: observed.' : 'Chest breathing waveform: unavailable.'} {' '}
        {report.metrics.abdomenWave.available ? 'Abdomen breathing waveform: observed.' : 'Abdomen breathing waveform: unavailable.'}</p>
    </div>
    <details className="wellness-report__coverage">
      <summary>Valid coverage by signal</summary>
      <ul>{METRICS.map(metric => <li key={metric}><span>{LABELS[metric]}</span><span>{report.metrics[metric].available ? `${report.metrics[metric].validSeconds}s observed · ${report.metrics[metric].samples} accepted` : 'Unavailable'}</span></li>)}</ul>
    </details>
    <div className="wellness-report__answers">
      <strong>Player answer</strong><p>{choice ? `Latest self-reported answer: ${choice}.` : 'No self-reported answer yet. The journal below is optional.'}</p>
    </div>
    <div className="wellness-report__tips">
      <strong>Game comfort suggestion</strong>
      {selectSuggestions(choice).map(tip => <p key={tip}>{tip}</p>)}
    </div>
    <p className="wellness-report__footnote">Signal observations, your answers, and suggestions are separate. This report is kept in memory for this shift only and is not saved or shared.</p>
  </section>;
}
