/**
 * useTransientRunner — submits a transient job and polls until done.
 * Uses reliable polling (2s interval). SSE streaming is a future enhancement.
 */
import { useTransientStore } from '../../store/transientStore';
import {
  submitTransientRun,
  getTransientStatus,
  getTransientResult,
} from '../../lib/api';
import { useCycleStore } from '../../store/cycleStore';

const POLL_INTERVAL_MS = 2000;

export function useTransientRunner() {
  const runTransient = async () => {
    const { config, startJob, updateJobStatus, setResult, setPollingTimer } =
      useTransientStore.getState();
    const simulationId = useCycleStore.getState().currentSimulationId;

    let jobId: number;
    try {
      const jobStatus = await submitTransientRun({
        fluid:               config.fluid,
        t_end:               config.t_end,
        t_steps:             config.t_steps,
        T0:                  config.T0,
        P0:                  config.P0,
        rtol:                config.rtol,
        atol:                config.atol,
        solver_method:       config.solver_method,
        stiffness_detection: config.stiffness_detection,
        components:          config.components,
        connections:         config.connections,
        simulation_id:       simulationId,
      });
      jobId = jobStatus.job_id;
      startJob(jobId);
    } catch (err: any) {
      useTransientStore.setState({
        jobStatus: 'failed',
        jobError:  err?.response?.data?.detail ?? err?.message ?? 'Failed to submit job.',
      });
      return;
    }

    // Poll every 2 s until terminal state
    const timer = setInterval(async () => {
      try {
        const s = await getTransientStatus(jobId);

        if (s.status === 'pending' || s.status === 'running') {
          updateJobStatus(s.status, s.progress ?? 0);
          return;
        }

        // Terminal — stop polling
        clearInterval(timer);
        useTransientStore.setState({ pollingTimer: null });

        if (s.status === 'failed') {
          updateJobStatus('failed', 0, s.error_msg ?? 'Solver failed.');
          return;
        }

        if (s.status === 'completed') {
          updateJobStatus('running', 0.95);
          try {
            const result = await getTransientResult(jobId);
            setResult(result);
          } catch {
            updateJobStatus('failed', 0, 'Failed to retrieve result.');
          }
        }
      } catch (err) {
        // Network hiccup — keep polling
        console.warn('[transient] poll error:', err);
      }
    }, POLL_INTERVAL_MS);

    setPollingTimer(timer);
  };

  return { runTransient };
}
