// Terraform skeleton for provisioning Postgres and basic infra.
// This file is a template and requires variables (do NOT apply without reviewing and providing provider credentials).

terraform {
  required_version = ">= 1.0"
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "db_identifier" {
  type    = string
  default = "althea-pay-db"
}

resource "aws_db_instance" "althea_pay_db" {
  allocated_storage    = 20
  engine               = "postgres"
  engine_version       = "14"
  instance_class       = "db.t3.micro"
  name                 = "althea_pay"
  identifier           = var.db_identifier
  username             = var.db_admin_username
  password             = var.db_admin_password
  skip_final_snapshot  = true
  publicly_accessible  = false
}

output "database_endpoint" {
  value = aws_db_instance.althea_pay_db.address
}
