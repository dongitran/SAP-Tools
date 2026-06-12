import { describe, expect, it, vi } from 'vitest';

import {
  readMicrosoftGraphToolRunRequest,
  runMicrosoftGraphTool,
  type MicrosoftGraphFetch,
  type MicrosoftGraphToolStepProgress,
} from './microsoftGraphTools';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function readBodyParams(body: BodyInit | null | undefined): URLSearchParams {
  if (!(body instanceof URLSearchParams)) {
    throw new Error('Expected URLSearchParams request body.');
  }
  return body;
}

function readJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    throw new Error('Expected JSON string request body.');
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected JSON object request body.');
  }
  return parsed as Record<string, unknown>;
}

describe('runMicrosoftGraphTool', () => {
  it('reads webview tool run messages without accepting unknown tool IDs', () => {
    expect(
      readMicrosoftGraphToolRunRequest({
        toolId: 'sharepoint',
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          tenantId: 'tenant-id',
          url: 'https://contoso.sharepoint.com',
          site: '/sites/team',
          rootDir: '/',
        },
      })
    ).toEqual({
      toolId: 'sharepoint',
      input: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        tenantId: 'tenant-id',
        url: 'https://contoso.sharepoint.com',
        site: '/sites/team',
        rootDir: '/',
      },
    });

    expect(readMicrosoftGraphToolRunRequest({ toolId: 'unknown', input: {} })).toBeNull();
  });

  it('validates Outlook OAuth2 credentials and sends mail without requiring user read permission', async () => {
    const progress: MicrosoftGraphToolStepProgress[] = [];
    const fetchMock = vi.fn<MicrosoftGraphFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'graph-token' }))
      .mockResolvedValueOnce(emptyResponse());

    const result = await runMicrosoftGraphTool(
      {
        toolId: 'outlook',
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          tenantId: 'tenant-id',
          senderEmail: 'sender@example.com',
          recipientEmail: 'recipient@example.com',
        },
      },
      { fetch: fetchMock, onProgress: (step) => progress.push(step) }
    );

    expect(result).toEqual({
      success: true,
      toolId: 'outlook',
      message: 'Outlook test completed. Test email was sent.',
    });
    expect(progress.map((step) => `${step.stepId}:${step.status}`)).toEqual([
      'token:running',
      'token:done',
      'send-mail:running',
      'send-mail:done',
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' })
    );
    const tokenBody = readBodyParams(fetchMock.mock.calls[0]?.[1].body);
    expect(tokenBody.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(tokenBody.get('grant_type')).toBe('client_credentials');
    expect(tokenBody.get('client_secret')).toBe('client-secret');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://graph.microsoft.com/v1.0/users/sender%40example.com/sendMail'
    );
    const sendMailBody = readJsonBody(fetchMock.mock.calls[1]?.[1].body);
    expect(JSON.stringify(sendMailBody)).toContain('recipient@example.com');
  });

  it('explains Outlook sendMail 403 without leaking the client secret', async () => {
    const progress: MicrosoftGraphToolStepProgress[] = [];
    const fetchMock = vi.fn<MicrosoftGraphFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'graph-token' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'ErrorAccessDenied',
              message: 'Access is denied. secret-value should never be echoed.',
            },
          },
          403
        )
      );

    const result = await runMicrosoftGraphTool(
      {
        toolId: 'outlook',
        input: {
          clientId: 'client-id',
          clientSecret: 'secret-value',
          tenantId: 'tenant-id',
          senderEmail: 'sender@example.com',
          recipientEmail: 'recipient@example.com',
        },
      },
      { fetch: fetchMock, onProgress: (step) => progress.push(step) }
    );

    expect(result).toEqual({
      success: false,
      toolId: 'outlook',
      message: 'Outlook test failed at "Send test email".',
    });
    expect(progress.at(-1)).toEqual({
      toolId: 'outlook',
      stepId: 'send-mail',
      status: 'failed',
      message:
        'Outlook sendMail request failed (403, ErrorAccessDenied). Check Microsoft Graph Mail.Send application permission, admin consent, and Exchange application access policy for the sender mailbox.',
    });
    expect(JSON.stringify(progress)).not.toContain('secret-value');
  });

  it('runs the SharePoint site, drive, root, create, upload, and cleanup checks', async () => {
    const progress: MicrosoftGraphToolStepProgress[] = [];
    const fetchMock = vi.fn<MicrosoftGraphFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'graph-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'site-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'drive-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'root-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-id' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-id' }, 201))
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse());

    const result = await runMicrosoftGraphTool(
      {
        toolId: 'sharepoint',
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          tenantId: 'tenant-id',
          url: 'https://contoso.sharepoint.com/sites/team',
          site: '/sites/team',
          rootDir: '/Shared Documents/Sub Folder',
        },
      },
      { fetch: fetchMock, onProgress: (step) => progress.push(step) }
    );

    expect(result.success).toBe(true);
    expect(progress.map((step) => `${step.stepId}:${step.status}`)).toEqual([
      'token:running',
      'token:done',
      'site:running',
      'site:done',
      'drive:running',
      'drive:done',
      'root:running',
      'root:done',
      'create-folder:running',
      'create-folder:done',
      'create-file:running',
      'create-file:done',
      'delete-file:running',
      'delete-file:done',
      'delete-folder:running',
      'delete-folder:done',
    ]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/team',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive/root:/Shared%20Documents/Sub%20Folder',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive/items/root-id/children',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive/items/folder-id:/sap-tools-graph-check.txt:/content',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive/items/file-id',
      'https://graph.microsoft.com/v1.0/sites/site-id/drive/items/folder-id',
    ]);
  });

  it('sanitizes Graph failures so client secrets are never returned', async () => {
    const progress: MicrosoftGraphToolStepProgress[] = [];
    const fetchMock = vi.fn<MicrosoftGraphFetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'invalid_client',
          error_description: 'The provided client-secret-value is invalid.',
        },
        401
      )
    );

    const result = await runMicrosoftGraphTool(
      {
        toolId: 'outlook',
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret-value',
          tenantId: 'tenant-id',
          senderEmail: 'sender@example.com',
          recipientEmail: 'recipient@example.com',
        },
      },
      { fetch: fetchMock, onProgress: (step) => progress.push(step) }
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Outlook test failed at "Validate OAuth2 app key".');
    expect(JSON.stringify(progress)).not.toContain('client-secret-value');
    expect(result.message).not.toContain('client-secret-value');
  });
});
