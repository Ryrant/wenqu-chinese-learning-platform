try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/api/v1/health`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const health = await response.json();
  // 健康接口在降级时仍返回 HTTP 200，必须检查业务状态。
  if (health.status !== "ok") throw new Error(`status_${health.status}`);
} catch (error) {
  console.error("docker_health_check_failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
