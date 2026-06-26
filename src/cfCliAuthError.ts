export function isRecoverableCfCliAuthError(error: unknown): boolean {
  const message = readCfCliErrorText(error).toLowerCase();
  if (message.length === 0) {
    return false;
  }
  if (
    message.includes('invalid sap credentials') ||
    message.includes('invalid credentials') ||
    message.includes('credentials were rejected') ||
    message.includes('bad credentials') ||
    message.includes('failed to authenticate cloud foundry cli')
  ) {
    return false;
  }

  return (
    message.includes('not logged in') ||
    message.includes('no api endpoint set') ||
    message.includes('no org targeted') ||
    message.includes('no space targeted') ||
    message.includes('no org and space targeted') ||
    message.includes('not authorized') ||
    message.includes('unauthorized') ||
    isRecoverableUnauthorizedStatus(message) ||
    message.includes('token expired') ||
    message.includes('refresh token expired')
  );
}

function isRecoverableUnauthorizedStatus(message: string): boolean {
  return (
    message.includes('401 unauthorized') ||
    message.includes('status 401') ||
    message.includes('http 401') ||
    message.includes('error 401')
  );
}

function readCfCliErrorText(error: unknown): string {
  const details: string[] = [];
  if (error instanceof Error) {
    details.push(error.message);
  }
  if (isRecord(error)) {
    const message = error['message'];
    const stderr = error['stderr'];
    if (typeof message === 'string') {
      details.push(message);
    }
    if (typeof stderr === 'string') {
      details.push(stderr);
    }
  }
  return details.length > 0 ? details.join(' ') : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
