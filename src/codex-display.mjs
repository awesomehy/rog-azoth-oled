export function codexModel(limits, error = null) {
  const bucket = limits?.find(item => item.id === 'codex') ?? limits?.[0];
  const weekly = bucket?.windows.find(window => window.durationMinutes === 10080);
  let resetDate = '--/--', resetTime = '--:--';
  if (Number.isFinite(weekly?.resetsAt)) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(weekly.resetsAt * 1000));
    const part = type => parts.find(item => item.type === type)?.value;
    resetDate = `${part('month')}/${part('day')}`;
    resetTime = `${part('hour')}:${part('minute')}`;
  }
  return {
    remaining: Number.isFinite(weekly?.remainingPercent) ? Math.round(weekly.remainingPercent) : null,
    resetDate, resetTime,
    footer: error ? weekly ? '离线缓存' : ['API_KEY_REQUIRED', 'UNAUTHORIZED'].includes(error.code) ? '需要密钥' : '接口不可用' : weekly ? '北京时间' : '等待周额度',
  };
}
