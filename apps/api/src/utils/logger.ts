type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  data?: unknown
}

/**
 * Recursively serializes data so that Error objects (including Axios errors
 * whose properties are non-enumerable) are fully captured in JSON output.
 */
function serializeData(data: unknown): unknown {
  if (data === null || data === undefined) return data

  if (data instanceof Error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosError = data as any
    return {
      message: data.message,
      name: data.name,
      stack: data.stack,
      // Axios-specific fields
      ...(axiosError.response ? {
        httpStatus: axiosError.response.status,
        httpStatusText: axiosError.response.statusText,
        responseData: axiosError.response.data
      } : {}),
      ...(axiosError.config ? {
        requestUrl: axiosError.config.url,
        requestMethod: axiosError.config.method
      } : {})
    }
  }

  if (Array.isArray(data)) return data.map(serializeData)

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = serializeData(value)
    }
    return result
  }

  return data
}

function formatLog(level: LogLevel, message: string, data?: unknown): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    data: serializeData(data)
  }
}

function writeLog(entry: LogEntry): void {
  const output = JSON.stringify(entry)
  if (entry.level === 'error') {
    console.error(output)
  } else if (entry.level === 'warn') {
    console.warn(output)
  } else {
    console.log(output)
  }
}

export const logger = {
  info: (message: string, data?: unknown) => {
    writeLog(formatLog('info', message, data))
  },
  warn: (message: string, data?: unknown) => {
    writeLog(formatLog('warn', message, data))
  },
  error: (message: string, data?: unknown) => {
    writeLog(formatLog('error', message, data))
  },
  debug: (message: string, data?: unknown) => {
    if (process.env.NODE_ENV !== 'production') {
      writeLog(formatLog('debug', message, data))
    }
  }
}
