/** External AWS SDK boundary; clients intentionally use the default credential chain. */
export { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
export { Upload } from '@aws-sdk/lib-storage'
export { DynamoDBClient } from '@aws-sdk/client-dynamodb'
export { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
export type { QueryCommandInput, ScanCommandInput } from '@aws-sdk/lib-dynamodb'
