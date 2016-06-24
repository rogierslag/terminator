# Terminator

## What is it?

Terminator is a tool we use at [inventid](https://www.inventid.nl) to prevent accidental merges of changes which have deployment impacts.
It works by checking files of your Pull request.
In case a PR has changed, added, or deleted a file which is listed it will set the PR to _pending_ to indicate this has deployment consequences.
This prevents accidental merges of such code

# What does it look like?

Almost the same as Consuela, so I jsut borrowed that one

![screenshot 2015-05-08 21 11 18](https://cloud.githubusercontent.com/assets/2778689/7543879/740e1df2-f5c8-11e4-95a5-9dd3032efda2.png)

![screenshot 2015-05-08 21 11 27](https://cloud.githubusercontent.com/assets/2778689/7543881/75dc53b0-f5c8-11e4-8ce1-a0a26a8b4437.png)

# How to use it?
It works really simple:

1. Copy the `default.json.example` to `default.json`
1. Edit the oauth token (that user should have write access to the repo)
1. Add the repository
1. Add the named files you wish to use to prevent merges
1. Add the webhook (add a webhook to the URL the system is running, use `application/json`, and leave the secret empty. As the hook, only select `Pull Request`.
1. Run system

## Plain node

```bash
node server.js
```

## Puppet

```puppet
class terminator {

  file { '/opt/terminator.json':
    ensure => present,
    source => 'puppet:///modules/terminator/config.json',
    mode   => '0600',
    notify => Docker::Run['terminator']
  }

  docker::image { 'rogierslag/terminator:latest': }

  docker::run { 'terminator':
    image => 'rogierslag/terminator',
    volumes => ['/opt/terminator.json:/opt/terminator/config/default.json'],
    ports => ["${ipaddress_eth0}:8543:8543"]
  }

  firewall { '200 allow terminator':
    dport => ['8543'],
    proto => 'tcp',
    action => 'accept'
  }
}
```

## Docker

```bash
sudo docker run -d -v /opt/terminator.json:/opt/terminator/config/default.json -p <IP>:8543:8543 rogierslag/terminator
```
