provider "aws" {
  profile = "default"
  region  = "us-east-1"
}

module "cloudwatch-log-group-x-papertrail" {
  source                  = "./tf_module_0.12"
  monitor_log_group_names = ["recast-container", "recast-container-dev", "recast-container-prod"]
  papertrail_host         = "logs.papertrailapp.com"
  papertrail_port         = "48745"
  filter_pattern          = ""
  timeout                 = "15"
  lambda_log_role_arn     = "arn:aws:iam::105642504987:role/Laterless-papertrail"
  lambda_name_prefix      = "laterless"
  parse_log_levels        = "false"
}
