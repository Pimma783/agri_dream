"""Reproducible demo infrastructure operations. AWS CLI only; never prints secret values.

Use `bootstrap` once, then `database`, `register`, `migrate`, `publish`, and `status`.
No resource deletion is implemented. Run only after the owner authorizes AWS costs.
"""
from pathlib import Path
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import fcntl
import zipfile
import hashlib
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
STATE_DIR = HERE / 'state'
PRIVATE_DIR = HERE / 'private'
for folder in (STATE_DIR, PRIVATE_DIR):
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    folder.chmod(0o700)
STATE_FILE = STATE_DIR / 'aws.json'
STATE = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
SAVED_STATE = json.loads(json.dumps(STATE))
PROFILE = 'ai-hackathon-936270099588'
REGION = 'ap-southeast-1'
PREFIX = 'agrimatch-demo-20261118'
DEMO_KEYS = ['DEMO_BALER_PASSWORD', 'DEMO_FACTORY_A_PASSWORD', 'DEMO_FACTORY_B_PASSWORD']
TAGS = [{'Key': 'Project', 'Value': 'Agrimatch'}, {'Key': 'ManagedBy', 'Value': 'agrimatch-hosting'}]


def save():
    lock_fd = os.open(STATE_DIR / 'state.lock', os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        merged = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
        merged.update({k: v for k, v in STATE.items() if k not in SAVED_STATE or SAVED_STATE[k] != v})
        with tempfile.NamedTemporaryFile(mode='w', dir=STATE_DIR, delete=False) as temp:
            json.dump(merged, temp, indent=2)
            temp_path = Path(temp.name)
        temp_path.chmod(0o600)
        temp_path.replace(STATE_FILE)
        STATE.clear()
        STATE.update(merged)
        SAVED_STATE.clear()
        SAVED_STATE.update(json.loads(json.dumps(merged)))


def aws(service, operation, payload=None):
    cmd = ['aws', service, operation, '--profile', PROFILE, '--region', REGION,
           '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '60']
    request_path = None
    try:
        if payload is not None:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', dir=PRIVATE_DIR, delete=False) as request:
                json.dump(payload, request)
                request_path = Path(request.name)
            request_path.chmod(0o600)
            cmd += ['--cli-input-json', f'file://{request_path}']
        result = subprocess.run(cmd, text=True, capture_output=True)
    finally:
        if request_path is not None:
            request_path.unlink(missing_ok=True)
    if result.returncode:
        if service == 'codebuild':
            # Build configuration contains no runtime credentials; preserve actionable diagnostics.
            raise RuntimeError(result.stderr.strip())
        code = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
        raise RuntimeError(f'{service}:{operation} failed: {code.group(1) if code else "CLI_ERROR"} (response withheld to protect credentials)')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def once(key, fn):
    if key not in STATE:
        STATE[key] = fn()
        save()
        print(f'Ready: {key}', flush=True)
    return STATE[key]


def role(key, suffix, principal, managed_policy=None):
    trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
             'Principal': {'Service': principal}, 'Action': 'sts:AssumeRole'}]}
    if principal == 'ecs-tasks.amazonaws.com':
        trust['Statement'][0]['Condition'] = {
            'StringEquals': {'aws:SourceAccount': STATE['account']},
            'ArnLike': {'aws:SourceArn': f'arn:aws:ecs:{REGION}:{STATE["account"]}:*'}}
    arn = once(key, lambda: aws('iam', 'create-role', {
        'RoleName': f'{PREFIX}-{suffix}', 'AssumeRolePolicyDocument': json.dumps(trust), 'Tags': TAGS})['Role']['Arn'])
    if managed_policy:
        aws('iam', 'attach-role-policy', {'RoleName': arn.rsplit('/', 1)[-1], 'PolicyArn': managed_policy})
    return arn


def bootstrap():
    STATE['account'] = aws('sts', 'get-caller-identity')['Account']
    if STATE['account'] != '936270099588':
        raise RuntimeError('Unexpected AWS account; refusing resource creation.')
    save()
    vpcs = aws('ec2', 'describe-vpcs', {'Filters': [{'Name': 'is-default', 'Values': ['true']}]})['Vpcs']
    if len(vpcs) != 1:
        raise RuntimeError('Expected one default VPC.')
    STATE['vpc'] = vpcs[0]['VpcId']
    STATE['vpc_cidr'] = vpcs[0]['CidrBlock']
    subnets = aws('ec2', 'describe-subnets', {'Filters': [{'Name': 'vpc-id', 'Values': [STATE['vpc']]}]})['Subnets']
    STATE['subnets'] = [s['SubnetId'] for s in subnets if s['MapPublicIpOnLaunch']]
    if len(STATE['subnets']) < 2:
        raise RuntimeError('Need two public subnets for ECS ingress and an RDS subnet group.')
    save()
    app_sg = once('app_sg', lambda: aws('ec2', 'create-security-group', {
        'GroupName': f'{PREFIX}-app', 'Description': 'Agrimatch app; ingress only from VPC load balancer',
        'VpcId': STATE['vpc'], 'TagSpecifications': [{'ResourceType': 'security-group', 'Tags': TAGS}]})['GroupId'])
    once('app_ingress', lambda: aws('ec2', 'authorize-security-group-ingress', {
        'GroupId': app_sg, 'IpPermissions': [{'IpProtocol': 'tcp', 'FromPort': 8080, 'ToPort': 8080,
        'IpRanges': [{'CidrIp': STATE['vpc_cidr'], 'Description': 'VPC load balancer to app'}]}]}) or True)
    db_sg = once('db_sg', lambda: aws('ec2', 'create-security-group', {
        'GroupName': f'{PREFIX}-db', 'Description': 'Private Agrimatch PostgreSQL', 'VpcId': STATE['vpc'],
        'TagSpecifications': [{'ResourceType': 'security-group', 'Tags': TAGS}]})['GroupId'])
    once('db_ingress', lambda: aws('ec2', 'authorize-security-group-ingress', {
        'GroupId': db_sg, 'IpPermissions': [{'IpProtocol': 'tcp', 'FromPort': 5432, 'ToPort': 5432,
        'UserIdGroupPairs': [{'GroupId': app_sg, 'Description': 'Agrimatch ECS tasks only'}]}]}) or True)
    once('db_subnets', lambda: aws('rds', 'create-db-subnet-group', {
        'DBSubnetGroupName': f'{PREFIX}-db', 'DBSubnetGroupDescription': 'Private-address PostgreSQL in the app VPC',
        'SubnetIds': STATE['subnets'], 'Tags': TAGS})['DBSubnetGroup']['DBSubnetGroupName'])
    private = PRIVATE_DIR / 'bootstrap.json'
    if not private.exists():
        fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'database_password': secrets.token_hex(24), 'session_secret': secrets.token_hex(48)}, f)
    credentials = json.loads(private.read_text())
    if 'app_password' not in credentials:
        credentials['app_password'] = secrets.token_hex(24)
        private.write_text(json.dumps(credentials))
        private.chmod(0o600)
    once('database_id', lambda: aws('rds', 'create-db-instance', {
        'DBInstanceIdentifier': PREFIX, 'AllocatedStorage': 20, 'DBInstanceClass': 'db.t4g.micro',
        'Engine': 'postgres', 'EngineVersion': '16.15', 'DBName': 'agrimatch', 'MasterUsername': 'agrimatch',
        'MasterUserPassword': credentials['database_password'], 'DBSubnetGroupName': STATE['db_subnets'],
        'VpcSecurityGroupIds': [db_sg], 'PubliclyAccessible': False, 'MultiAZ': False,
        'StorageEncrypted': True, 'StorageType': 'gp3', 'BackupRetentionPeriod': 7,
        'AutoMinorVersionUpgrade': True, 'DeletionProtection': True, 'Tags': TAGS})['DBInstance']['DBInstanceIdentifier'])
    once('repository', lambda: aws('ecr', 'create-repository', {
        'repositoryName': PREFIX, 'imageTagMutability': 'IMMUTABLE',
        'imageScanningConfiguration': {'scanOnPush': True},
        'encryptionConfiguration': {'encryptionType': 'AES256'},
        'tags': [{'Key': t['Key'], 'Value': t['Value']} for t in TAGS]})['repository']['repositoryUri'])
    once('cluster', lambda: aws('ecs', 'create-cluster', {
        'clusterName': PREFIX, 'tags': [{'key': t['Key'], 'value': t['Value']} for t in TAGS]})['cluster']['clusterArn'])
    for key in ('app', 'worker', 'migrate', 'verify'):
        once(f'logs_{key}', lambda key=key: aws('logs', 'create-log-group', {'logGroupName': f'/agrimatch/{PREFIX}/{key}'}) or f'/agrimatch/{PREFIX}/{key}')
        aws('logs', 'put-retention-policy', {'logGroupName': f'/agrimatch/{PREFIX}/{key}', 'retentionInDays': 7})
    role('execution_role', 'execution', 'ecs-tasks.amazonaws.com',
         'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy')
    role('infrastructure_role', 'infrastructure', 'ecs.amazonaws.com',
         'arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices')
    task = role('task_role', 'runtime', 'ecs-tasks.amazonaws.com')
    # Application policy is generated by AWS IAM Policy Autopilot, unchanged.
    generated = json.loads((HERE / 'runtime-policy.generated.json').read_text())['Policies'][0]['Policy']
    aws('iam', 'put-role-policy', {'RoleName': task.rsplit('/', 1)[-1], 'PolicyName': 'GeneratedBedrockRuntime',
                                'PolicyDocument': json.dumps(generated)})
    # A separate boundary restricts that baseline to the explicitly selected API/model/Region.
    boundary = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'bedrock:InvokeModel',
        'Resource': f'arn:aws:bedrock:{REGION}::foundation-model/anthropic.claude-sonnet-5'}]}
    boundary_arn = once('task_boundary', lambda: aws('iam', 'create-policy', {
        'PolicyName': f'{PREFIX}-bedrock-boundary', 'PolicyDocument': json.dumps(boundary), 'Tags': TAGS})['Policy']['Arn'])
    aws('iam', 'put-role-permissions-boundary', {'RoleName': task.rsplit('/', 1)[-1], 'PermissionsBoundary': boundary_arn})
    print('Bootstrap complete; database may still be creating. No database port is public.', flush=True)


def database():
    db = aws('rds', 'describe-db-instances', {'DBInstanceIdentifier': STATE['database_id']})['DBInstances'][0]
    print('Database status:', db['DBInstanceStatus'], flush=True)
    if db['DBInstanceStatus'] != 'available':
        return
    endpoint = db['Endpoint']['Address']
    STATE['database_host'] = endpoint
    save()
    private = json.loads((PRIVATE_DIR / 'bootstrap.json').read_text())
    local = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines()
                 if '=' in line and not line.lstrip().startswith('#'))
    # Separate hosted credentials; never copy the local DATABASE_URL or AWS SSO cache.
    query = f'@{endpoint}:5432/agrimatch?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem'
    values = {'SESSION_SECRET': private['session_secret'], 'APP_DATABASE_PASSWORD': private['app_password'],
        'DATABASE_URL': f'postgresql://agrimatch_app:{quote(private["app_password"], safe="")}{query}',
        'MIGRATION_DATABASE_URL': f'postgresql://agrimatch:{quote(private["database_password"], safe="")}{query}'}
    for role_key in ('FARMER', 'BALER', 'FACTORY'):
        for suffix in ('CHANNEL_SECRET', 'ACCESS_TOKEN'):
            key = f'LINE_{role_key}_{suffix}'
            if not local.get(key) or local[key] == 'fake':
                raise RuntimeError(f'Missing {key}; value withheld.')
            values[key] = local[key]
    if 'secret_arn' not in STATE:
        try:
            STATE['secret_arn'] = aws('secretsmanager', 'describe-secret', {'SecretId': f'{PREFIX}/runtime'})['ARN']
        except RuntimeError as error:
            if 'ResourceNotFoundException' not in str(error):
                raise
            STATE['secret_arn'] = aws('secretsmanager', 'create-secret', {
                'Name': f'{PREFIX}/runtime', 'SecretString': json.dumps(values), 'Tags': TAGS})['ARN']
        save()
    permission = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
        'Action': 'secretsmanager:GetSecretValue', 'Resource': STATE['secret_arn']}]}
    aws('iam', 'put-role-policy', {'RoleName': STATE['execution_role'].rsplit('/', 1)[-1],
        'PolicyName': 'ReadAgrimatchRuntimeOnly', 'PolicyDocument': json.dumps(permission)})
    print('Hosted secret configured; no values printed.', flush=True)


def register(image):
    env = {'NODE_ENV': 'production', 'AWS_REGION': REGION, 'ENABLE_REAL_LINE': 'true',
        'ENABLE_REAL_BEDROCK': 'true', 'VISION_ENABLED': 'false', 'AI_MODE': 'disabled',
        'BEDROCK_MODEL_ID': 'anthropic.claude-sonnet-5', 'BEDROCK_VISION_MODEL_ID': 'anthropic.claude-sonnet-5',
        'API_INTERNAL_URL': 'http://127.0.0.1:4000', 'WEB_ORIGIN': STATE.get('url', 'https://localhost.invalid'),
        'LINE_FARMER_BASIC_ID': '@642ctpqm', 'LINE_BALER_BASIC_ID': '@237ozbsh', 'LINE_FACTORY_BASIC_ID': '@241sxehz'}
    secret_keys = ['DATABASE_URL', 'SESSION_SECRET'] + [f'LINE_{r}_{s}' for r in ('FARMER','BALER','FACTORY') for s in ('CHANNEL_SECRET','ACCESS_TOKEN')]
    modes = ['app', 'worker', 'migrate', 'verify'] + (['seed'] if STATE.get('seed_execution_role') else [])
    for mode in modes:
        bindings = [{'name': k, 'valueFrom': f'{STATE["secret_arn"]}:{"MIGRATION_DATABASE_URL" if mode == "migrate" and k == "DATABASE_URL" else k}::'} for k in secret_keys]
        if mode == 'migrate':
            bindings.append({'name': 'APP_DATABASE_PASSWORD', 'valueFrom': f'{STATE["secret_arn"]}:APP_DATABASE_PASSWORD::'})
        task_env = dict(env)
        execution_role = STATE['execution_role']
        if mode == 'seed':
            # Only the app role's DATABASE_URL, plus the demo passwords from their own secret. No LINE or session values.
            bindings = [{'name': 'DATABASE_URL', 'valueFrom': f'{STATE["secret_arn"]}:DATABASE_URL::'}] + [
                {'name': k, 'valueFrom': f'{STATE["demo_secret_arn"]}:{k}::'} for k in DEMO_KEYS]
            task_env = {'NODE_ENV': 'production', 'AWS_REGION': REGION, 'SEED_DEMO_CONFIRM': 'yes'}
            execution_role = STATE['seed_execution_role']
        definition = {'family': f'{PREFIX}-{mode}', 'executionRoleArn': execution_role, 'taskRoleArn': STATE['task_role'],
            'networkMode': 'awsvpc', 'requiresCompatibilities': ['FARGATE'], 'cpu': '512' if mode != 'app' else '1024',
            'memory': '1024' if mode != 'app' else '2048', 'runtimePlatform': {'cpuArchitecture': 'X86_64', 'operatingSystemFamily': 'LINUX'},
            'containerDefinitions': [{'name': 'Main', 'image': image, 'essential': True, 'command': [mode],
                'environment': [{'name': k, 'value': v} for k, v in task_env.items()],
                'secrets': bindings,
                'stopTimeout': 60, 'logConfiguration': {'logDriver': 'awslogs', 'options': {
                    'awslogs-group': f'/agrimatch/{PREFIX}/{mode}', 'awslogs-region': REGION, 'awslogs-stream-prefix': mode}}}],
            'tags': [{'key': t['Key'], 'value': t['Value']} for t in TAGS]}
        if mode == 'app':
            definition['containerDefinitions'][0]['portMappings'] = [{'name': 'http', 'containerPort': 8080, 'protocol': 'tcp'}]
        STATE[f'task_{mode}'] = aws('ecs', 'register-task-definition', definition)['taskDefinition']['taskDefinitionArn']
        save()
    STATE['image'] = image
    save()
    print('Registered app, worker and migration task definitions.', flush=True)


def image(local_image):
    inspected = subprocess.run(['docker', 'image', 'inspect', local_image, '--format', '{{.Id}}'],
                               text=True, capture_output=True, check=True).stdout.strip()
    if STATE.get('local_image_id') == inspected and STATE.get('image_uri'):
        print('Image already uploaded:', STATE['image_uri'], flush=True)
        return
    digest = inspected.split(':', 1)[-1]
    if not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise RuntimeError('Unexpected local image identifier.')
    target = f'{STATE["repository"]}:build-{digest[:12]}'
    registry = STATE['repository'].split('/', 1)[0]
    docker_config = PRIVATE_DIR / 'docker'
    docker_config.mkdir(mode=0o700, exist_ok=True)
    env = {**os.environ, 'DOCKER_CONFIG': str(docker_config)}
    password = subprocess.run(['aws', 'ecr', 'get-login-password', '--profile', PROFILE, '--region', REGION],
                              text=True, capture_output=True, check=True).stdout
    login = subprocess.run(['docker', 'login', '--username', 'AWS', '--password-stdin', registry],
                           input=password, text=True, capture_output=True, env=env)
    if login.returncode:
        raise RuntimeError('Registry sign-in failed; credentials withheld.')
    subprocess.run(['docker', 'tag', local_image, target], check=True, env=env)
    subprocess.run(['docker', 'push', target], check=True, env=env)
    STATE['image_uri'] = target
    STATE['local_image_id'] = inspected
    save()
    print('Uploaded:', target, flush=True)


def cloud_build():
    bucket = f'{PREFIX}-{STATE["account"]}-sources'
    once('source_bucket', lambda: aws('s3api', 'create-bucket', {'Bucket': bucket,
        'CreateBucketConfiguration': {'LocationConstraint': REGION}}) and bucket)
    # S3's successful response can be empty in some regions; record the known owned name.
    STATE['source_bucket'] = bucket
    save()
    aws('s3api', 'put-public-access-block', {'Bucket': bucket, 'PublicAccessBlockConfiguration': {
        'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True}})
    aws('s3api', 'put-bucket-encryption', {'Bucket': bucket, 'ServerSideEncryptionConfiguration': {
        'Rules': [{'ApplyServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]}})
    aws('s3api', 'put-bucket-versioning', {'Bucket': bucket, 'VersioningConfiguration': {'Status': 'Enabled'}})
    aws('s3api', 'put-bucket-policy', {'Bucket': bucket, 'Policy': json.dumps({'Version': '2012-10-17',
        'Statement': [{'Sid': 'DenyInsecureTransport', 'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
            'Resource': [f'arn:aws:s3:::{bucket}', f'arn:aws:s3:::{bucket}/*'],
            'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}]})})
    source = PRIVATE_DIR / 'source.zip'
    members = [ROOT / n for n in ['package.json', 'package-lock.json', '.dockerignore']]
    members += list(ROOT.glob('tsconfig*.json'))
    for parent in ['apps', 'packages', 'db']:
        for base, dirs, files in os.walk(ROOT / parent):
            dirs[:] = [d for d in dirs if d not in {'node_modules', '.next', 'dist', 'test', 'coverage', '.git'}]
            for name in files:
                if not name.startswith('.env') and not name.endswith('.tsbuildinfo') and '.test.' not in name:
                    members.append(Path(base) / name)
    members += [HERE / n for n in ['Dockerfile', 'nginx.conf', 'entrypoint.mjs', 'migrate.mjs', 'verify.mjs']]
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for member in sorted(set(members)):
            archive.write(member, member.relative_to(ROOT).as_posix())
    source.chmod(0o600)
    with zipfile.ZipFile(source) as archive:
        if any(part.startswith('.env') or part in {'private', '.aws', 'node_modules'} for n in archive.namelist() for part in Path(n).parts):
            raise RuntimeError('Private inputs found in source bundle; refusing upload.')
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    object_key = f'sources/{source_hash}.zip'
    uploaded = subprocess.run(['aws', 's3api', 'put-object', '--profile', PROFILE, '--region', REGION,
        '--bucket', bucket, '--key', object_key, '--body', str(source), '--server-side-encryption', 'AES256',
        '--output', 'json', '--no-cli-pager'], text=True, capture_output=True)
    if uploaded.returncode:
        raise RuntimeError('Source upload failed; response withheld.')
    print(f'Uploaded private source bundle: {source.stat().st_size} bytes.', flush=True)
    log_group = f'/aws/codebuild/{PREFIX}'
    log_arn = f'arn:aws:logs:{REGION}:{STATE["account"]}:log-group:{log_group}'
    key_policy = {'Version': '2012-10-17', 'Statement': [
        {'Sid': 'AccountAdministration', 'Effect': 'Allow', 'Principal': {'AWS': f'arn:aws:iam::{STATE["account"]}:root'},
         'Action': 'kms:*', 'Resource': '*'},
        {'Sid': 'BuildLogsOnly', 'Effect': 'Allow', 'Principal': {'Service': f'logs.{REGION}.amazonaws.com'},
         'Action': ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
         'Resource': '*', 'Condition': {'ArnEquals': {'kms:EncryptionContext:aws:logs:arn': log_arn}}}]}
    kms = once('build_logs_key', lambda: aws('kms', 'create-key', {'Description': 'Agrimatch build logs',
        'Policy': json.dumps(key_policy), 'Tags': [{'TagKey': t['Key'], 'TagValue': t['Value']} for t in TAGS]})['KeyMetadata']['Arn'])
    once('build_logs', lambda: aws('logs', 'create-log-group', {'logGroupName': log_group, 'kmsKeyId': kms}) or log_group)
    aws('logs', 'put-retention-policy', {'logGroupName': log_group, 'retentionInDays': 7})
    project_arn = f'arn:aws:codebuild:{REGION}:{STATE["account"]}:project/{PREFIX}'
    trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'Service': 'codebuild.amazonaws.com'},
        'Action': 'sts:AssumeRole', 'Condition': {'StringEquals': {'aws:SourceAccount': STATE['account']},
            'ArnEquals': {'aws:SourceArn': project_arn}}}]}
    build_role = once('build_role', lambda: aws('iam', 'create-role', {'RoleName': f'{PREFIX}-build',
        'AssumeRolePolicyDocument': json.dumps(trust), 'Tags': TAGS})['Role']['Arn'])
    policy = {'Version': '2012-10-17', 'Statement': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject', 's3:GetObjectVersion'], 'Resource': f'arn:aws:s3:::{bucket}/sources/*'},
        {'Effect': 'Allow', 'Action': ['s3:GetBucketLocation', 's3:GetBucketAcl'], 'Resource': f'arn:aws:s3:::{bucket}'},
        {'Effect': 'Allow', 'Action': ['logs:CreateLogStream', 'logs:PutLogEvents'], 'Resource': log_arn + ':*'},
        {'Effect': 'Allow', 'Action': 'ecr:GetAuthorizationToken', 'Resource': '*'},
        {'Effect': 'Allow', 'Action': ['ecr:BatchCheckLayerAvailability', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart',
            'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
         'Resource': f'arn:aws:ecr:{REGION}:{STATE["account"]}:repository/{PREFIX}'}]}
    aws('iam', 'put-role-policy', {'RoleName': build_role.rsplit('/', 1)[-1], 'PolicyName': 'BuildOnlyThisApplication',
        'PolicyDocument': json.dumps(policy)})
    registry = STATE['repository'].split('/', 1)[0]
    buildspec = {'version': '0.2', 'env': {'shell': 'bash', 'exported-variables': ['IMAGE_URI']},
        'phases': {'pre_build': {'commands': ['docker info',
            f'aws ecr get-login-password --region {REGION} | docker login --username AWS --password-stdin {registry}',
            f'export IMAGE_URI={STATE["repository"]}:cloud-${{CODEBUILD_BUILD_NUMBER}}-{source_hash[:10]}']},
        'build': {'commands': ['docker build -t "$IMAGE_URI" -f infra/hosting/Dockerfile .']},
        'post_build': {'commands': ['test "$CODEBUILD_BUILD_SUCCEEDING" = 1', 'docker push "$IMAGE_URI"']}}}
    configuration = {'source': {'type': 'S3', 'location': f'{bucket}/{object_key}', 'buildspec': json.dumps(buildspec)},
        'artifacts': {'type': 'NO_ARTIFACTS'}, 'environment': {'type': 'LINUX_CONTAINER',
            'image': 'aws/codebuild/standard:7.0', 'computeType': 'BUILD_GENERAL1_SMALL', 'privilegedMode': True},
        'serviceRole': build_role, 'timeoutInMinutes': 20, 'queuedTimeoutInMinutes': 10,
        'logsConfig': {'cloudWatchLogs': {'status': 'ENABLED', 'groupName': log_group}},
        'cache': {'type': 'LOCAL', 'modes': ['LOCAL_DOCKER_LAYER_CACHE']}}
    if 'build_project' not in STATE:
        STATE['build_project'] = aws('codebuild', 'create-project', {'name': PREFIX,
            'description': 'Build Agrimatch images from a private source snapshot; no runtime credentials.',
            **configuration, 'tags': [{'key': t['Key'], 'value': t['Value']} for t in TAGS]})['project']['name']
        save()
    else:
        aws('codebuild', 'update-project', {'name': STATE['build_project'], **configuration})
    build = aws('codebuild', 'start-build', {'projectName': STATE['build_project']})['build']
    STATE['build_id'] = build['id']
    STATE['source_hash'] = source_hash
    save()
    print('Cloud build started:', STATE['build_id'], flush=True)


def build_status():
    build = aws('codebuild', 'batch-get-builds', {'ids': [STATE['build_id']]})['builds'][0]
    print(json.dumps({'status': build['buildStatus'], 'phase': build.get('currentPhase'),
        'logs': build.get('logs', {}).get('streamName'),
        'contexts': [p.get('contexts') for p in build.get('phases', []) if p.get('phaseStatus') in ['FAILED', 'FAULT', 'TIMED_OUT']]}), flush=True)
    if build['buildStatus'] == 'SUCCEEDED':
        exported = {v['name']: v['value'] for v in build.get('exportedEnvironmentVariables', [])}
        STATE['image_uri'] = exported['IMAGE_URI']
        save()
        print('Verified cloud image:', STATE['image_uri'], flush=True)


def migrate():
    result = aws('ecs', 'run-task', {'cluster': STATE['cluster'], 'taskDefinition': STATE['task_migrate'],
        'launchType': 'FARGATE', 'platformVersion': 'LATEST', 'count': 1,
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': STATE['subnets'], 'securityGroups': [STATE['app_sg']], 'assignPublicIp': 'ENABLED'}}})
    if result.get('failures') or not result.get('tasks'):
        raise RuntimeError('Migration task placement failed.')
    STATE['migration_task'] = result['tasks'][0]['taskArn']
    save()
    print('Migration task started. Inspect task completion before publishing.', flush=True)


def verify():
    result = aws('ecs', 'run-task', {'cluster': STATE['cluster'], 'taskDefinition': STATE['task_verify'],
        'launchType': 'FARGATE', 'platformVersion': 'LATEST', 'count': 1,
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': STATE['subnets'], 'securityGroups': [STATE['app_sg']], 'assignPublicIp': 'ENABLED'}}})
    if result.get('failures') or not result.get('tasks'):
        raise RuntimeError('Verification task placement failed.')
    STATE['verification_task'] = result['tasks'][0]['taskArn']
    save()
    print('Hosted runtime verification task started.', flush=True)


def seed_setup():
    """Creates the demo-account secret (new, random passwords), the seed log group and the seed-only execution role."""
    private = PRIVATE_DIR / 'demo-accounts.json'
    if not private.exists():
        fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({k: secrets.token_urlsafe(24) for k in DEMO_KEYS}, f)
    private.chmod(0o600)
    values = json.loads(private.read_text())
    if sorted(values) != sorted(DEMO_KEYS):
        raise RuntimeError('Private demo account file has unexpected keys; refusing.')
    name = f'{PREFIX}/demo-accounts'
    if 'demo_secret_arn' not in STATE:
        try:
            STATE['demo_secret_arn'] = aws('secretsmanager', 'describe-secret', {'SecretId': name})['ARN']
        except RuntimeError as error:
            if 'ResourceNotFoundException' not in str(error):
                raise
            STATE['demo_secret_arn'] = aws('secretsmanager', 'create-secret', {
                'Name': name, 'SecretString': json.dumps(values), 'Tags': TAGS})['ARN']
        save()
    group = f'/agrimatch/{PREFIX}/seed'
    existing = aws('logs', 'describe-log-groups', {'logGroupNamePrefix': group})['logGroups']
    if not any(g['logGroupName'] == group for g in existing):
        aws('logs', 'create-log-group', {'logGroupName': group})
    aws('logs', 'put-retention-policy', {'logGroupName': group, 'retentionInDays': 7})
    role('seed_execution_role', 'seed-execution', 'ecs-tasks.amazonaws.com',
         'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy')
    # The demo secret is readable by this role only. The runtime secret is needed for the app-role DATABASE_URL.
    aws('iam', 'put-role-policy', {'RoleName': STATE['seed_execution_role'].rsplit('/', 1)[-1],
        'PolicyName': 'ReadSeedSecretsOnly', 'PolicyDocument': json.dumps({'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Action': 'secretsmanager:GetSecretValue',
            'Resource': [STATE['secret_arn'], STATE['demo_secret_arn']]}]})})
    print('Seed prerequisites ready (secret, log group, execution role). No values printed.', flush=True)


def seed():
    if 'task_seed' not in STATE:
        raise RuntimeError('Run seed-setup, then register the image again, before seeding.')
    result = aws('ecs', 'run-task', {'cluster': STATE['cluster'], 'taskDefinition': STATE['task_seed'],
        'launchType': 'FARGATE', 'platformVersion': 'LATEST', 'count': 1,
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': STATE['subnets'], 'securityGroups': [STATE['app_sg']], 'assignPublicIp': 'ENABLED'}}})
    if result.get('failures') or not result.get('tasks'):
        raise RuntimeError('Seed task placement failed.')
    STATE['seed_task'] = result['tasks'][0]['taskArn']
    save()
    print('Seed task started:', STATE['seed_task'], flush=True)


def seed_status():
    """Prints the seed task state, exit code and its own log lines (counts and entity ids only)."""
    task = aws('ecs', 'describe-tasks', {'cluster': STATE['cluster'], 'tasks': [STATE['seed_task']]})['tasks'][0]
    print('Seed task:', task['lastStatus'], 'exit', task['containers'][0].get('exitCode'), 'stopped:', task.get('stoppedReason'), flush=True)
    task_id = STATE['seed_task'].rsplit('/', 1)[-1]
    try:
        events = aws('logs', 'get-log-events', {'logGroupName': f'/agrimatch/{PREFIX}/seed',
            'logStreamName': f'seed/Main/{task_id}', 'startFromHead': True})['events']
    except RuntimeError:
        events = []
    for event in events:
        print(event['message'], flush=True)


def publish():
    # Express Mode's tagged managed policy failed ModifyRule during the first update.
    # Keep the recovery permission limited to the verified rule for this service.
    if STATE.get('gateway_rule'):
        aws('iam', 'put-role-policy', {'RoleName': STATE['infrastructure_role'].rsplit('/', 1)[-1],
            'PolicyName': 'ModifyAgrimatchGatewayRule', 'PolicyDocument': json.dumps({
                'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow',
                    'Action': 'elasticloadbalancing:ModifyRule', 'Resource': STATE['gateway_rule']}]})})
    if 'migration_task' not in STATE:
        raise RuntimeError('Run the migration task first.')
    tasks = aws('ecs', 'describe-tasks', {'cluster': STATE['cluster'], 'tasks': [STATE['migration_task']]})['tasks']
    if not tasks or tasks[0]['lastStatus'] != 'STOPPED' or tasks[0]['containers'][0].get('exitCode') != 0:
        raise RuntimeError('Migration has not completed successfully; refusing deployment.')
    if 'service_arn' not in STATE:
        result = aws('ecs', 'create-express-gateway-service', {'serviceName': PREFIX, 'cluster': STATE['cluster'],
            'taskDefinitionArn': STATE['task_app'], 'infrastructureRoleArn': STATE['infrastructure_role'],
            'healthCheckPath': '/healthz', 'networkConfiguration': {'subnets': STATE['subnets'], 'securityGroups': [STATE['app_sg']]},
            'scalingTarget': {'minTaskCount': 1, 'maxTaskCount': 1},
            'tags': [{'key': t['Key'], 'value': t['Value']} for t in TAGS]})
        STATE['service_arn'] = result['service']['serviceArn']
        save()
    else:
        aws('ecs', 'update-express-gateway-service', {'serviceArn': STATE['service_arn'], 'taskDefinitionArn': STATE['task_app']})
    once('worker_service', lambda: aws('ecs', 'create-service', {'cluster': STATE['cluster'], 'serviceName': f'{PREFIX}-worker',
        'taskDefinition': STATE['task_worker'], 'desiredCount': 0, 'launchType': 'FARGATE', 'platformVersion': 'LATEST',
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': STATE['subnets'], 'securityGroups': [STATE['app_sg']], 'assignPublicIp': 'ENABLED'}},
        'tags': [{'key': t['Key'], 'value': t['Value']} for t in TAGS]})['service']['serviceArn'])
    aws('ecs', 'update-service', {'cluster': STATE['cluster'], 'service': STATE['worker_service'],
        'taskDefinition': STATE['task_worker'], 'desiredCount': 0})
    print('Application deployment requested; worker intentionally parked at zero until line_event handler is ready.', flush=True)


def status():
    if 'database_id' in STATE:
        db = aws('rds', 'describe-db-instances', {'DBInstanceIdentifier': STATE['database_id']})['DBInstances'][0]
        print('Database:', db['DBInstanceStatus'], flush=True)
    if 'migration_task' in STATE:
        task = aws('ecs', 'describe-tasks', {'cluster': STATE['cluster'], 'tasks': [STATE['migration_task']]})['tasks'][0]
        print('Migration:', task['lastStatus'], 'exit', task['containers'][0].get('exitCode'), flush=True)
    if 'service_arn' in STATE:
        result = aws('ecs', 'describe-express-gateway-service', {'serviceArn': STATE['service_arn']})
        # Store non-secret infrastructure metadata for diagnosis and handover.
        (STATE_DIR / 'service.json').write_text(json.dumps(result, indent=2))
        service = result['service']
        endpoints = [i['endpoint'] for cfg in service.get('activeConfigurations', []) for i in cfg.get('ingressPaths', []) if i.get('accessType') == 'PUBLIC']
        if endpoints:
            endpoint = endpoints[0]
            STATE['url'] = endpoint.rstrip('/') if endpoint.startswith('https://') else 'https://' + endpoint.rstrip('/')
            save()
        print(json.dumps({'status': service.get('status'), 'url': STATE.get('url'), 'configurations': len(service.get('activeConfigurations', []))}), flush=True)


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        if command == 'bootstrap': bootstrap()
        elif command == 'database': database()
        elif command == 'register' and len(sys.argv) == 3: register(sys.argv[2])
        elif command == 'image' and len(sys.argv) == 3: image(sys.argv[2])
        elif command == 'build': cloud_build()
        elif command == 'build-status': build_status()
        elif command == 'migrate': migrate()
        elif command == 'verify': verify()
        elif command == 'seed-setup': seed_setup()
        elif command == 'seed': seed()
        elif command == 'seed-status': seed_status()
        elif command == 'publish': publish()
        elif command == 'status': status()
        else: raise RuntimeError('Use bootstrap, database, register IMAGE, migrate, publish, status, seed-setup, seed, or seed-status.')
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else f'Operation failed: {type(error).__name__}; details withheld.', file=sys.stderr)
        sys.exit(1)
