# AWS storage setup

VidPipe can store media in private S3 objects and review metadata in DynamoDB.
Azure remains the default. Set `STORAGE_PROVIDER=aws` explicitly to select AWS;
AWS mode does not require Azure account settings.

This guide describes manual provisioning and configuration. Adding
`infra\aws\storage.yaml` to the repository **does not deploy anything**, migrate
recordings, restart a server, or publish social posts. Provisioning and actual
uploads require separate authorization.

## Authenticate without storing AWS keys in VidPipe

VidPipe leaves credentials to the AWS SDK for JavaScript's default credential
chain. Use your organization's IAM Identity Center/SSO profile, shared AWS
profile, or workload role. Do not put access keys or session tokens in
`vidpipe configure`, source control, stack outputs, or documentation.

For an already configured SSO profile, authenticate in PowerShell:

```powershell
aws sso login --profile vidpipe
$env:AWS_PROFILE = 'vidpipe'
```

`AWS_PROFILE` is a standard AWS environment setting, not a VidPipe global
default. Existing AWS environment credentials also work through the SDK chain;
avoid mixing credential sources unintentionally. Workload roles do not require
static access keys. See AWS's
[Node.js credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html),
[SSO authentication guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-your-credentials.html),
and [profile settings reference](https://docs.aws.amazon.com/sdkref/latest/guide/settings-reference.html).

## Choose new or existing resources

### New resources: optional manual CloudFormation deployment

The template creates:

- A generated-name S3 bucket with public access blocked, ACLs disabled,
  SSE-S3 encryption, versioning, and a deny policy for non-TLS requests.
- Two generated-name, on-demand DynamoDB tables with encryption and
  point-in-time recovery.
- A runtime managed policy, **not** an IAM user, role, access key, or trust policy.

The bucket, bucket policy and tables are retained on stack deletion/replacement.
Deleting a stack is not data cleanup; retained resources and stored versions
can continue to incur charges. The only lifecycle rule aborts incomplete
multipart uploads after seven days. It does not expire completed objects,
versions, review records, or publication history.

`ObjectPrefix` defaults to empty (the whole dedicated bucket). To limit objects,
list permissions, and multipart cleanup to a namespace, use a prefix such as
`vidpipe` or `team/media`. Template prefixes accept slash-separated letters,
digits, underscores and hyphens, with no leading/trailing slash or wildcards.
Keep the configured application prefix identical to the stack output.

An authorized administrator can run the following **manually**, after reviewing
the template, account, Region, costs, and deployment permissions:

```powershell
aws cloudformation deploy --template-file .\infra\aws\storage.yaml --stack-name vidpipe-storage --region us-west-2 --profile vidpipe-admin --capabilities CAPABILITY_IAM --parameter-overrides ObjectPrefix=vidpipe
aws cloudformation describe-stacks --stack-name vidpipe-storage --region us-west-2 --profile vidpipe-admin --query 'Stacks[0].Outputs'
```

Deployment permissions are separate from runtime data access. The runtime
policy cannot provision resources. An administrator must attach the returned
`RuntimePolicyArn` to a user-chosen runtime principal. For IAM Identity Center,
manage that access through the appropriate permission set; for workloads,
attach it to the existing execution role. This template does not choose who
can assume a role or automatically attach its policy.

Runtime grants use explicit S3 get/put/delete/abort/list-parts actions on only
the selected object namespace, prefix-constrained bucket listing, and explicit
DynamoDB operations on the tables and exact indexes. `DeleteObject` supports
cleanup of the current attempt's isolated upload objects; it is not permission
to purge historical object versions. The bucket policy's `s3:*` is an explicit
**deny** of insecure transport on this bucket, not a wildcard runtime grant.
Other policies, permission boundaries and organization restrictions still apply.

The resource properties follow the official
[S3 CloudFormation reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html),
[DynamoDB CloudFormation reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html),
and [multipart lifecycle reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-abortincompletemultipartupload.html).

### Existing compatible resources: no stack required

Configure an existing private bucket and compatible tables directly; do not
deploy a second stack merely to use them. Verify their security, Region,
permissions, and schemas first. If using customer-managed KMS encryption,
your administrator must additionally grant appropriate access to those keys;
the supplied runtime policy assumes SSE-S3 and DynamoDB-managed encryption.

All DynamoDB key attributes below are strings. Both indexes project `ALL`.

| Table | Primary key | Index | Index keys |
|-------|-------------|-------|------------|
| Content | `itemId` HASH + `videoSlug` RANGE | `status-createdAt-index` | `status` HASH + `statusSortKey` RANGE |
| Content | same | `videoSlug-itemId-index` | `videoSlug` HASH + `itemId` RANGE |
| Videos | `runId` HASH | `status-createdAt-index` | `status` HASH + `createdAt` RANGE |

The backend builds content `statusSortKey` as
`createdAt#itemId#videoSlug`. Do not substitute `createdAt` as the content
index sort attribute. The composite content primary key preserves identical
item IDs belonging to different videos.

## Configure VidPipe

CloudFormation output logical IDs must be alphanumeric, so the template uses
the following IDs. Each output's **Description** is the exact application
environment-variable name (not an automatically applied setting).
See [CloudFormation output syntax](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html).

| Stack output | Environment setting | `configure` alias | Global default / SDK option |
|--------------|---------------------|-------------------|-----------------------------|
| `StorageProvider` | `STORAGE_PROVIDER` | `storage-provider` | `storageProvider` |
| `AwsRegion` | `AWS_REGION` | `aws-region` | `awsRegion` |
| `AwsS3Bucket` | `AWS_S3_BUCKET` | `aws-s3-bucket` | `awsS3Bucket` |
| `AwsS3Prefix` | `AWS_S3_PREFIX` | `aws-s3-prefix` | `awsS3Prefix` |
| `AwsDynamodbContentTable` | `AWS_DYNAMODB_CONTENT_TABLE` | `aws-dynamodb-content-table` | `awsDynamodbContentTable` |
| `AwsDynamodbVideosTable` | `AWS_DYNAMODB_VIDEOS_TABLE` | `aws-dynamodb-videos-table` | `awsDynamodbVideosTable` |

`RuntimePolicyArn` is for the administrator, not application configuration.
Only the provider defaults to `azure`; AWS settings default to empty strings.
The AWS backend requires Region, bucket, and both table names. The prefix is
optional. Missing resources or credentials are checked by the selected backend,
not by requiring static access keys during configuration loading.

Values resolve **CLI/SDK options > environment (including `.env`) > global
defaults > built-in defaults**. An explicit empty CLI/SDK string clears a
resource value; empty environment/global strings fall through. Providers must
be exactly `azure` or `aws`; other values fail clearly.

Using the newly built checkout, set non-secret defaults from actual stack
outputs (this writes local VidPipe configuration, not AWS data):

```powershell
$outputs = aws cloudformation describe-stacks --stack-name vidpipe-storage --region us-west-2 --profile vidpipe-admin --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$aliases = @{
  STORAGE_PROVIDER = 'storage-provider'
  AWS_REGION = 'aws-region'
  AWS_S3_BUCKET = 'aws-s3-bucket'
  AWS_S3_PREFIX = 'aws-s3-prefix'
  AWS_DYNAMODB_CONTENT_TABLE = 'aws-dynamodb-content-table'
  AWS_DYNAMODB_VIDEOS_TABLE = 'aws-dynamodb-videos-table'
}
foreach ($output in $outputs) {
  if ($aliases.ContainsKey($output.Description)) {
    # Unset/empty global prefix is the default; no empty native argument needed.
    if ($output.Description -eq 'AWS_S3_PREFIX' -and !$output.OutputValue) { continue }
    node .\dist\cli.js configure set $aliases[$output.Description] $output.OutputValue
    if ($LASTEXITCODE -ne 0) { throw 'VidPipe configuration failed' }
  }
}
node .\dist\cli.js configure list
```

For an empty stack prefix, also remove any previously configured nonempty
`AWS_S3_PREFIX` environment value or `defaults.awsS3Prefix` global value before
using this example. `configure` accepts `defaults.awsRegion` and the other
camelCase keys using dot notation. Use the `AWS_*` environment variables instead
when the deployment environment manages configuration. Do not assume a globally
installed `vidpipe` has this checkout's AWS implementation.

## Inspect and migrate safely

Before any real migration, use the built checkout for an inventory-only run:

```powershell
node .\dist\cli.js cloud migrate --dry-run --source-dir 'C:\VidPipe\output'
```

The source directory contains the local `publish-queue` and `published`
folders. Dry-run reads those sources and checks the selected cloud backend;
it performs no uploads or metadata writes. Review eligible, existing/skipped,
invalid, and failed counts; investigate errors before requesting an actual
migration. No actual-data operation is part of infrastructure setup.

Migration leaves local sources untouched. Published history is imported before
pending content; published records stay published and do not enter the pending
queue. Existing cloud items are skipped regardless of status, preserving cloud
edits, approval state, and publication history. Reruns do not overwrite records.
Migration does not schedule or publish posts. Failed or incomplete uploads must
not become reviewable metadata; S3 and DynamoDB are not one atomic transaction.

An initial authentication, resource, or connectivity failure is an error,
**not evidence of an empty queue**. Fix the selected AWS settings/profile/
permissions and retry; do not treat a failed initialization as "no posts pending."
Changing `OUTPUT_DIR` alone does not import local folders into cloud review.

## Boundaries and verification

AWS supports local processing with cloud storage, review, upload, download,
status and local migration. AWS remote GitHub Actions processing and cloud
configuration push/pull are unsupported and must fail before transfers or
workflow dispatch. Existing Azure remote operations remain Azure-specific.

Local tests parse the template and check its schema, security, IAM scopes,
output mapping and application configuration. They do not authenticate,
deploy, or upload. AWS-side template validation and an opt-in synthetic smoke
test require separately authorized AWS access; no deployment is implied by
passing local tests.
