FROM ubuntu:24.04

# Install system dependencies including make and build tools
RUN apt-get -qq update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    git \
    jq \
    make \
    pandoc \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    lmodern \
    musl-tools \
    xxd && \
    rm -rf /var/lib/apt/lists/*

# Create dev user with uid/gid 1000
RUN groupadd -o -g 134 docker && groupadd -o -g 1000 user && \
    useradd -o -u 1000 -g 1000 -d /src -m -s /bin/bash user

# Install rustup with binaries in /usr/local/bin, but toolchains/data in /src
ENV RUSTUP_HOME=/src/.rustup
ENV CARGO_HOME=/src/.cargo
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo \
    sh -s -- -y --no-modify-path --default-toolchain none && \
    mv /usr/local/cargo/bin/* /usr/local/bin/ && \
    rm -rf /usr/local/rustup /usr/local/cargo

# User environment (project-specific cargo/rustup/nvm data stored in workspace)
ENV HOME=/src
ENV NVM_DIR=/src/.nvm
ENV PATH="/src/.cargo/bin:/src/.local/bin:${PATH}"

# Reproducible builds environment
ENV SOURCE_DATE_EPOCH=0
ENV CARGO_INCREMENTAL=0
ENV HISTFILE=/dev/null

WORKDIR /src
