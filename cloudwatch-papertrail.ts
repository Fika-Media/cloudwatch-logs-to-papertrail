import * as AwsLambda from "aws-lambda";
import * as zlib from "zlib";
import * as winston from "winston";
import "winston-papertrail";

function unarchiveLogData(payload: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(payload, function (err, result) {
      if (err) {
        return reject(err);
      } else {
        return resolve(result);
      }
    });
  }).then((rawData) => {
    return JSON.parse(rawData.toString("utf8"));
  });
}

interface CloudwatchLogGroupsEvent {
  awslogs: {
    data: string;
  };
}

interface LogMessage {
  id: string;
  timestamp: number;
  message: string;
}

interface LogData {
  owner: string;
  logGroup: string;
  logStream: string;
  subscriptionFilters: string[];
  messageType: string;
  logEvents: LogMessage[];
}

function getEnvVarOrFail(varName: string): string {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`Required environment variable ${varName} is undefined`);
  }
  return value;
}

// Should match winston simple log format for example: "error: The database has exploded"
// For more information see https://github.com/winstonjs/winston
// The pattern represents the following:
// A sequence of non-tab chars at the start of input followed by a tab
// Another sequence of non-tabs followed by a tab
// Capture a group of alphanumeric chars leading up to a ':'
const logLevelRegex = /^[^\t]+\t[^\t]+\t(\w+):/;

export function parseLogLevel(tsvMessage: string): string | null {
  // Messages logged manually are tab separated value strings of three columns:
  // date string (ISO8601), request ID, log message
  const match = logLevelRegex.exec(tsvMessage);
  return match && match[1].toUpperCase();
}

export const handler: AwsLambda.Handler = (event: CloudwatchLogGroupsEvent, context, callback) => {
  const host = getEnvVarOrFail("PAPERTRAIL_HOST");
  const port = getEnvVarOrFail("PAPERTRAIL_PORT");
  const shouldParseLogLevels = getEnvVarOrFail("PARSE_LOG_LEVELS") === "true";
  const payload = new Buffer(event.awslogs.data, "base64");

  unarchiveLogData(payload)
    .then((logData: LogData) => {
      const papertrailTransport = new winston.transports.Papertrail({
        host,
        port,
        program: logData.logStream,
        hostname: logData.logGroup,
        flushOnClose: true,
        colorize: true,
      });

      const logger = new winston.Logger({
        transports: [papertrailTransport],
      });
      logger.on("error", (err) => {
        console.log("Error sending logs to papertrail: " + err);
      });

      logData.logEvents.forEach(function (event) {
        try {
          if (
            !event.message.startsWith("START RequestId") &&
            !event.message.startsWith("END RequestId") &&
            !event.message.startsWith("REPORT RequestId") &&
            !event.message.startsWith('{"_aws"') &&
            !event.message.startsWith("[NR_EXT]")
          ) {
            const parsed_message = JSON.parse(event.message);
            if (parsed_message.message) {
              let logLevel = (parsed_message.level || "info").toLowerCase();
              if (logLevel === "warning") {
                logLevel = "warn"
              }
              const location = parsed_message.location || "unknown_location";
              const user_id = (parsed_message.user || { id: "unknown_user" }).id || "unknown_user";
              logger.log(
                logLevel,
                JSON.stringify({ user_id: user_id, location: location, message: parsed_message.message })
              );
            } else {
              logger.log("info", event.message);
            }
          }
        } catch (e) {
          console.log(`Error ${e} parsing message: ${event.message}`);
        }
      });

      logger.close();
      return callback!(null);
    })
    .catch(callback!);
};
